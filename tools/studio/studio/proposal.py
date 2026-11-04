"""Propose course.yaml from the ingested PDFs.

Rules, applied to each PDF in natural filename order:

- a PDF with a real outline (at least two top-level entries that are not generated
  "Slide N" bookmarks) becomes one unit per top-level entry;
- any other PDF with text becomes one unit, titled from its filename;
- a PDF without extractable text is left out, with a warning.

The proposal is a starting point the owner corrects; later stages only read course.yaml.
"""

import re
from datetime import date

from studio.config import StudioConfig
from studio.course import COURSE_NAME, COURSE_VERSION, CourseFile, SourceRange, Unit
from studio.ingest import OutlineEntry, PdfPages

GENERATED_BOOKMARK = re.compile(r"^(slide|page|slajd|stranica)\s*\d+$", re.IGNORECASE)
# A single lecture deck rarely passes this; a whole-course PDF (PPJ: 1061 pages) does.
LARGE_UNIT_PAGES = 300
NOISY_SHARE = 0.2


def natural_key(text: str) -> list[tuple[int, int | str]]:
    return [
        (0, int(part)) if part.isdigit() else (1, part.lower())
        for part in re.split(r"(\d+)", text)
        if part
    ]


def title_from_filename(stem: str) -> str:
    title = re.sub(r"\[\d+\]", "", stem)
    title = title.replace("_", " ")
    title = re.sub(r"^\s*\d+\s*[.)_-]*\s*", "", title)
    title = re.sub(r"\s*-\s*(19|20)\d\d\s*$", "", title)
    title = " ".join(title.split()).strip(" -.")
    if " " not in title:  # "Sigurnost-web-aplikacija"
        title = title.replace("-", " ")
    return title or stem


def outline_units(doc: PdfPages) -> list[OutlineEntry]:
    if not doc.outline:
        return []
    top_level = min(e.level for e in doc.outline)
    entries = [e for e in doc.outline if e.level == top_level]
    if any(GENERATED_BOOKMARK.match(e.title) for e in entries):
        return []
    by_page: dict[int, OutlineEntry] = {}
    for entry in sorted(entries, key=lambda e: e.page):
        by_page.setdefault(entry.page, entry)
    return list(by_page.values()) if len(by_page) >= 2 else []


def file_name(doc: PdfPages) -> str:
    return doc.source.rsplit("/", 1)[-1]


def propose(config: StudioConfig, docs: list[PdfPages]) -> tuple[CourseFile, list[str]]:
    units: list[Unit] = []
    warnings: list[str] = []

    def add(title: str, slug: str, start: int, end: int) -> None:
        pages = str(start) if start == end else f"{start}-{end}"
        units.append(
            Unit(
                id=f"{len(units) + 1:02d}",
                title=title[:200],
                sources=[SourceRange(pdf=slug, pages=pages)],
            )
        )

    for doc in sorted(docs, key=lambda d: natural_key(file_name(d))):
        if doc.page_count == 0 or doc.count("no_text") == doc.page_count:
            warnings.append(
                f"{doc.slug}: no extractable text (scanned?), left out; "
                "OCR is not part of the studio yet"
            )
            continue
        noisy = doc.count("ocr_noise")
        if noisy > NOISY_SHARE * doc.page_count:
            warnings.append(
                f"{doc.slug}: {noisy} of {doc.page_count} pages show OCR damage; "
                "quotes from them will match less reliably"
            )
        entries = outline_units(doc)
        if entries:
            if entries[0].page > 1:
                add("Uvod", doc.slug, 1, entries[0].page - 1)
            for entry, following in zip(entries, [*entries[1:], None], strict=True):
                end = following.page - 1 if following else doc.page_count
                add(entry.title, doc.slug, entry.page, end)
            continue
        add(title_from_filename(file_name(doc).rsplit(".", 1)[0]), doc.slug, 1, doc.page_count)
        if doc.page_count > LARGE_UNIT_PAGES:
            warnings.append(
                f"{doc.slug}: no outline, so all {doc.page_count} pages form one unit; "
                "split it into units by page range"
            )

    if not units:
        warnings.append("no PDF has text, so there are no units; this proposal is not usable")
        units.append(Unit(id="01", title="TODO", sources=[SourceRange(pdf="TODO", pages="1")]))
    return CourseFile(version=COURSE_VERSION, course=config.course, units=units), warnings


def proposal_header(warnings: list[str], today: date) -> list[str]:
    header = [
        f"Proposed by `studio ingest` on {today.isoformat()}.",
        f"Check titles and page ranges, add exam_cycles, then save as {COURSE_NAME}.",
        "exam_cycles example:  - {name: MI, units: ['01', '02']}",
    ]
    if warnings:
        header += ["", "Warnings:", *(f"- {w}" for w in warnings)]
    return header
