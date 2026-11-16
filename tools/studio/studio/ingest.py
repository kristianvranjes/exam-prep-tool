"""Stage 1, ingest: page-level text per PDF.

Page numbers matter because every later statement and question cites a page. Lines that
repeat on most pages (slide headers and footers) are kept out of the page body, and pages
are flagged when they carry no text (scanned) or show OCR damage, so later stages know
where grounding checks are weak. A PDF whose bytes have not changed is not re-read.
"""

import hashlib
import json
import os
import re
import unicodedata
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

import pypdfium2 as pdfium
from pydantic import BaseModel, ConfigDict, ValidationError

from studio.config import StudioError
from studio.ocr import cached_pages
from studio.store import write_json

PAGES_VERSION: Literal["studio-pages-v1"] = "studio-pages-v1"
# The black square and the replacement character mark letters an OCR pass could not
# map (in FER scans, typically č, ć and đ).
NOISE_CHARS = frozenset("■�")
MIN_TEXT_CHARS = 20
REPEAT_SHARE = 0.6
REPEAT_MIN_PAGES = 4
EDGE_LINES = 2

# "ocr": the page's text comes from `studio ocr`, not from the PDF's own text layer.
PageFlag = Literal["no_text", "ocr_noise", "ocr"]


class Model(BaseModel):
    model_config = ConfigDict(extra="forbid")


class OutlineEntry(Model):
    title: str
    page: int
    level: int


class Page(Model):
    page: int
    text: str
    body: str
    flags: list[PageFlag]


class PdfPages(Model):
    version: Literal["studio-pages-v1"]
    slug: str
    source: str
    sha256: str
    page_count: int
    outline: list[OutlineEntry]
    repeated_lines: list[str]
    pages: list[Page]
    # Hash of the `studio ocr` pages used, so new OCR text triggers a fresh ingest.
    ocr_digest: str | None = None

    def count(self, flag: PageFlag) -> int:
        return sum(1 for p in self.pages if flag in p.flags)


@dataclass(frozen=True)
class IngestResult:
    doc: PdfPages
    path: Path
    skipped: bool


def pages_dir(studio_dir: Path) -> Path:
    return studio_dir / "build" / "pages"


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def slugify(stem: str) -> str:
    ascii_stem = (
        unicodedata.normalize("NFKD", stem.replace("đ", "d").replace("Đ", "D"))
        .encode("ascii", "ignore")
        .decode()
    )
    slug = re.sub(r"[^a-z0-9]+", "-", ascii_stem.lower()).strip("-")
    return slug[:60].rstrip("-") or "pdf"


def line_key(line: str) -> str:
    """Normalize a line so a header matches across pages despite page numbers."""
    return re.sub(r"\d+", "#", " ".join(line.split()).lower())


def edge_lines(text: str) -> list[str]:
    """The first and last lines of a page: at most two, and a quarter of a short page."""
    lines = [line for line in text.splitlines() if line.strip()]
    edge = min(EDGE_LINES, max(1, len(lines) // 4))
    if len(lines) <= 2 * edge:
        return lines
    return lines[:edge] + lines[-edge:]


def find_repeated(texts: list[str]) -> dict[str, str]:
    """Map of line key to its first spelling, for header/footer lines on most pages.

    Only the first and last lines of a page are candidates, so a content line that
    differs between slides only by a number ("Korak 1", "Korak 2") is never removed.
    """
    with_text = [t for t in texts if len(t.strip()) >= MIN_TEXT_CHARS]
    if len(with_text) < REPEAT_MIN_PAGES:
        return {}
    counts: Counter[str] = Counter()
    spelling: dict[str, str] = {}
    for text in with_text:
        keys = set()
        for line in edge_lines(text):
            key = line_key(line)
            if len(key) >= 3:
                keys.add(key)
                spelling.setdefault(key, " ".join(line.split()))
        counts.update(keys)
    threshold = REPEAT_SHARE * len(with_text)
    return {key: spelling[key] for key, n in counts.items() if n >= threshold}


def page_body(text: str, repeated: dict[str, str]) -> str:
    lines = [" ".join(line.split()) for line in text.splitlines()]
    return "\n".join(line for line in lines if line and line_key(line) not in repeated)


def page_flags(text: str) -> list[PageFlag]:
    flags: list[PageFlag] = []
    stripped = text.strip()
    if len(stripped) < MIN_TEXT_CHARS:
        flags.append("no_text")
    noise = sum(1 for ch in stripped if ch in NOISE_CHARS)
    if noise >= 3 or (stripped and noise / len(stripped) > 0.01):
        flags.append("ocr_noise")
    return flags


def _normalize(raw: str) -> str:
    return unicodedata.normalize("NFC", raw.replace("\r\n", "\n").replace("\r", "\n"))


def read_pdf(path: Path) -> tuple[list[str], list[OutlineEntry]]:
    try:
        document = pdfium.PdfDocument(str(path))
    except pdfium.PdfiumError as exc:
        raise StudioError(f"cannot open {path.name}: {exc}") from None
    try:
        texts = []
        for index in range(len(document)):
            page = document[index]
            textpage = page.get_textpage()
            texts.append(_normalize(textpage.get_text_range()))
            textpage.close()
            page.close()
        outline = []
        for item in document.get_toc(max_depth=3):
            dest = item.get_dest()
            page_index = dest.get_index() if dest is not None else None
            title = " ".join(item.get_title().split())
            if page_index is not None and title:
                outline.append(OutlineEntry(title=title, page=page_index + 1, level=item.level))
        return texts, outline
    finally:
        document.close()


def display_path(path: Path, studio_dir: Path) -> str:
    try:
        return Path(os.path.relpath(path, studio_dir.resolve())).as_posix()
    except ValueError:  # another drive on Windows
        return path.as_posix()


def load_pages(path: Path) -> PdfPages | None:
    try:
        return PdfPages.model_validate_json(path.read_text(encoding="utf-8"))
    except (OSError, ValidationError, ValueError):
        return None


def ocr_digest(ocr: dict[int, str]) -> str | None:
    if not ocr:
        return None
    encoded = json.dumps(sorted(ocr.items()), ensure_ascii=False).encode()
    return hashlib.sha256(encoded).hexdigest()


def ingest_pdf(pdf: Path, slug: str, studio_dir: Path, *, force: bool = False) -> IngestResult:
    out = pages_dir(studio_dir) / f"{slug}.json"
    digest = sha256_file(pdf)
    ocr = cached_pages(studio_dir, slug, digest)
    ocr_hash = ocr_digest(ocr)
    if not force and out.is_file():
        existing = load_pages(out)
        if existing is not None and existing.sha256 == digest and existing.ocr_digest == ocr_hash:
            return IngestResult(existing, out, skipped=True)
    texts, outline = read_pdf(pdf)
    # Pages read again by `studio ocr` replace the PDF's own text layer.
    for page, text in ocr.items():
        if 1 <= page <= len(texts):
            texts[page - 1] = _normalize(text.replace("\f", ""))
    repeated = find_repeated(texts)

    def flags(page: int, text: str) -> list[PageFlag]:
        found = page_flags(text)
        return [*found, "ocr"] if page in ocr else found

    doc = PdfPages(
        version=PAGES_VERSION,
        slug=slug,
        source=display_path(pdf, studio_dir),
        sha256=digest,
        page_count=len(texts),
        outline=outline,
        repeated_lines=sorted(repeated.values()),
        pages=[
            Page(page=i + 1, text=text, body=page_body(text, repeated), flags=flags(i + 1, text))
            for i, text in enumerate(texts)
        ],
        ocr_digest=ocr_hash,
    )
    write_json(out, doc)
    return IngestResult(doc, out, skipped=False)


def assign_slugs(pdfs: list[Path]) -> list[tuple[Path, str]]:
    seen: Counter[str] = Counter()
    assigned = []
    for pdf in pdfs:
        base = slugify(pdf.stem)
        seen[base] += 1
        assigned.append((pdf, base if seen[base] == 1 else f"{base}-{seen[base]}"))
    return assigned


def ingest_all(pdfs: list[Path], studio_dir: Path, *, force: bool = False) -> list[IngestResult]:
    return [ingest_pdf(pdf, slug, studio_dir, force=force) for pdf, slug in assign_slugs(pdfs)]


def load_all_pages(studio_dir: Path) -> dict[str, PdfPages]:
    docs = {}
    for path in sorted(pages_dir(studio_dir).glob("*.json")):
        doc = load_pages(path)
        if doc is not None:
            docs[doc.slug] = doc
    return docs
