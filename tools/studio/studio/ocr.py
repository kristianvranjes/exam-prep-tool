"""`studio ocr`: read scanned or badly OCR'd pages again with Tesseract.

Each selected page is rendered at `dpi` with pdfium and read by the Tesseract command
line in the given languages (Croatian and English by default). The text goes to a cache,
`build/ocr/<pdf slug>/pNNNN.txt`, tied to the PDF's SHA-256, the languages and the DPI;
`studio ingest` then uses a cached page instead of the PDF's own text layer. Page
numbers never change, so page ranges in course.yaml stay valid. The PDF itself is not
modified.

By default only pages flagged by ingest (no text, or OCR damage such as ■ for č/ć/đ) are
read; `--all-pages` reads every page.

Tesseract is found through STUDIO_TESSERACT, the PATH, or its default Windows location;
language data through STUDIO_TESSDATA or `%LOCALAPPDATA%/examprep-studio/tessdata`.
"""

import os
import shutil
import subprocess
import tempfile
from collections.abc import Callable, Iterable
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pypdfium2 as pdfium
from pydantic import BaseModel, ConfigDict, ValidationError

from studio.config import StudioError
from studio.store import write_json

OCR_VERSION = "studio-ocr-v1"
WINDOWS_TESSERACT = Path("C:/Program Files/Tesseract-OCR/tesseract.exe")


class OcrMeta(BaseModel):
    model_config = ConfigDict(extra="forbid")

    version: str
    pdf_sha256: str
    lang: str
    dpi: int


def ocr_dir(studio_dir: Path, slug: str) -> Path:
    return studio_dir / "build" / "ocr" / slug


def page_file(studio_dir: Path, slug: str, page: int) -> Path:
    return ocr_dir(studio_dir, slug) / f"p{page:04d}.txt"


def load_meta(studio_dir: Path, slug: str) -> OcrMeta | None:
    try:
        text = (ocr_dir(studio_dir, slug) / "meta.json").read_text(encoding="utf-8")
        return OcrMeta.model_validate_json(text)
    except (OSError, ValidationError, ValueError):
        return None


def cached_pages(studio_dir: Path, slug: str, pdf_sha256: str) -> dict[int, str]:
    """OCR text per page for this exact PDF, empty when there is none or it is stale."""
    meta = load_meta(studio_dir, slug)
    if meta is None or meta.version != OCR_VERSION or meta.pdf_sha256 != pdf_sha256:
        return {}
    pages = {}
    for path in sorted(ocr_dir(studio_dir, slug).glob("p*.txt")):
        try:
            pages[int(path.stem[1:])] = path.read_text(encoding="utf-8")
        except (OSError, ValueError):
            continue
    return pages


def tesseract_binary() -> Path:
    found = os.environ.get("STUDIO_TESSERACT") or shutil.which("tesseract")
    if found:
        return Path(found)
    if WINDOWS_TESSERACT.is_file():
        return WINDOWS_TESSERACT
    raise StudioError("Tesseract not found; install it or set STUDIO_TESSERACT to tesseract.exe")


def tessdata_dir() -> Path | None:
    configured = os.environ.get("STUDIO_TESSDATA")
    if configured:
        return Path(configured)
    local = os.environ.get("LOCALAPPDATA")
    candidate = Path(local) / "examprep-studio" / "tessdata" if local else None
    return candidate if candidate and candidate.is_dir() else None


Reader = Callable[[Path, str], str]


def tesseract_reader() -> Reader:
    binary = tesseract_binary()
    data = tessdata_dir()

    def read(image: Path, lang: str) -> str:
        command = [str(binary), str(image), "stdout", "-l", lang, "--psm", "3"]
        if data is not None:
            command += ["--tessdata-dir", str(data)]
        result = subprocess.run(
            command, capture_output=True, text=True, encoding="utf-8", errors="replace"
        )
        if result.returncode != 0:
            message = " ".join(result.stderr.split())[:200]
            raise StudioError(f"tesseract failed on {image.name}: {message}")
        return result.stdout

    return read


def ocr_pages(
    pdf: Path,
    slug: str,
    pdf_sha256: str,
    pages: Iterable[int],
    studio_dir: Path,
    *,
    lang: str = "hrv+eng",
    dpi: int = 300,
    jobs: int = 4,
    reader: Reader | None = None,
    progress: Callable[[int, int], None] | None = None,
) -> int:
    """Read the given pages into the cache and return how many were read now."""
    target = ocr_dir(studio_dir, slug)
    meta = OcrMeta(version=OCR_VERSION, pdf_sha256=pdf_sha256, lang=lang, dpi=dpi)
    if load_meta(studio_dir, slug) != meta:
        shutil.rmtree(target, ignore_errors=True)
    target.mkdir(parents=True, exist_ok=True)
    write_json(target / "meta.json", meta)
    todo = sorted({p for p in pages if not page_file(studio_dir, slug, p).is_file()})
    if not todo:
        return 0
    read = reader or tesseract_reader()

    try:
        document = pdfium.PdfDocument(str(pdf))
    except pdfium.PdfiumError as exc:
        raise StudioError(f"cannot open {pdf.name}: {exc}") from None

    def finish(page: int, image: Path) -> None:
        text = read(image, lang)
        image.unlink(missing_ok=True)
        out = page_file(studio_dir, slug, page)
        tmp = out.with_suffix(".tmp")
        tmp.write_text(text, encoding="utf-8")
        tmp.replace(out)

    done = 0
    with (
        tempfile.TemporaryDirectory(prefix="studio-ocr-") as scratch,
        ThreadPoolExecutor(max_workers=max(1, jobs)) as pool,
    ):
        futures = []
        try:
            # pdfium is not thread-safe: render here, read the images in the pool.
            for page in todo:
                if not 1 <= page <= len(document):
                    continue
                image = Path(scratch) / f"p{page:04d}.png"
                document[page - 1].render(scale=dpi / 72).to_pil().save(image)
                futures.append(pool.submit(finish, page, image))
            for future in futures:
                future.result()
                done += 1
                if progress is not None:
                    progress(done, len(futures))
        finally:
            document.close()
    return done
