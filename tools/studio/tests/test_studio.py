import shutil
from collections.abc import Callable
from pathlib import Path

import pytest
import yaml
from pdfgen import make_pdf

from studio.cli import main
from studio.config import (
    Course,
    Sources,
    StudioConfig,
    StudioError,
    ensure_outside_repo,
    load_config,
    render_template,
)
from studio.course import CourseFile, check_pages, dump_course, load_course
from studio.ingest import PdfPages, find_repeated, ingest_pdf, page_body, page_flags
from studio.proposal import propose, title_from_filename

HEADER = "Laboratorij za sigurnost Sigurnost racunalnih sustava"
WORDS = ["kljuc", "blok", "runda", "napad", "sol", "hash", "potpis", "certifikat"]


def deck(n: int, topic: str) -> list[list[str]]:
    return [
        [
            HEADER,
            f"{topic}: {WORDS[i % len(WORDS)]}",
            f"Korak {i}",  # differs only by a number, but it is content, not a header
            f"Pojam {WORDS[(i + 3) % len(WORDS)]} u temi {topic}.",
            f"{i} od {n}",
        ]
        for i in range(1, n + 1)
    ]


def config(tmp_path: Path) -> StudioConfig:
    (tmp_path / "studio.toml").write_text(
        render_template("Sigurnost računalnih sustava", "SRS", ["pdf/*.pdf"]), encoding="utf-8"
    )
    return load_config(tmp_path)


def write(path: Path, data: bytes) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    return path


def ingested(tmp_path: Path, name: str, pdf: bytes, slug: str) -> PdfPages:
    return ingest_pdf(write(tmp_path / "pdf" / name, pdf), slug, tmp_path).doc


def test_repeated_headers_and_numbered_footers_leave_the_body() -> None:
    texts = ["\n".join(lines) for lines in deck(6, "AES")]
    repeated = find_repeated(texts)
    body = page_body(texts[2], repeated)
    assert HEADER not in body and "od 6" not in body
    assert body.splitlines() == ["AES: napad", "Korak 3", "Pojam potpis u temi AES."]


def test_page_flags_mark_empty_and_ocr_damaged_pages() -> None:
    assert page_flags("  ") == ["no_text"]
    assert page_flags("Prevo■enje programskih jezika, Srblji■, ■") == ["ocr_noise"]
    assert page_flags("Prevođenje programskih jezika") == []


def test_ingest_reads_pages_and_skips_unchanged_pdf(tmp_path: Path) -> None:
    pdf = write(tmp_path / "pdf" / "01. Uvod.pdf", make_pdf(deck(5, "Uvod")))
    first = ingest_pdf(pdf, "01-uvod", tmp_path)
    assert not first.skipped
    assert first.doc.page_count == 5
    assert first.doc.source == "pdf/01. Uvod.pdf"
    assert first.doc.repeated_lines == ["1 od 5", HEADER]
    assert "Korak 2" in first.doc.pages[1].body

    assert ingest_pdf(pdf, "01-uvod", tmp_path).skipped
    write(pdf, make_pdf(deck(6, "Uvod")))
    again = ingest_pdf(pdf, "01-uvod", tmp_path)
    assert not again.skipped and again.doc.page_count == 6


def test_proposal_has_one_unit_per_pdf_in_natural_order(tmp_path: Path) -> None:
    names = ["10-Sigurnost mreze - 2026.pdf", "2. Kriptografija[1].pdf", "01. Uvod.pdf"]
    docs = [ingested(tmp_path, n, make_pdf(deck(4, n)), f"d{i}") for i, n in enumerate(names)]
    course, warnings = propose(config(tmp_path), docs)
    assert [(u.id, u.title) for u in course.units] == [
        ("01", "Uvod"),
        ("02", "Kriptografija"),
        ("03", "Sigurnost mreze"),
    ]
    assert course.units[2].sources[0].pages == "1-4"
    assert warnings == []


def test_proposal_splits_a_pdf_by_its_real_outline(tmp_path: Path) -> None:
    pdf = make_pdf(deck(5, "PPJ"), outline=[("Leksicka analiza", 2), ("Sintaksna analiza", 4)])
    course, _ = propose(config(tmp_path), [ingested(tmp_path, "ppj.pdf", pdf, "ppj")])
    assert [(u.title, u.sources[0].pages) for u in course.units] == [
        ("Uvod", "1"),
        ("Leksicka analiza", "2-3"),
        ("Sintaksna analiza", "4-5"),
    ]


def test_proposal_ignores_generated_slide_bookmarks(tmp_path: Path) -> None:
    pdf = make_pdf(deck(3, "AES"), outline=[("Slide 0", 1), ("Slide 1", 2), ("Slide 2", 3)])
    course, _ = propose(config(tmp_path), [ingested(tmp_path, "01. AES.pdf", pdf, "aes")])
    assert [(u.title, u.sources[0].pages) for u in course.units] == [("AES", "1-3")]


def test_proposal_leaves_out_pdfs_without_text(tmp_path: Path) -> None:
    scanned = ingested(tmp_path, "skripta.pdf", make_pdf([[], []]), "s")
    lecture = ingested(tmp_path, "01 Uvod.pdf", make_pdf(deck(4, "U")), "u")
    course, warnings = propose(config(tmp_path), [scanned, lecture])
    assert [u.sources[0].pdf for u in course.units] == ["u"]
    assert any(w.startswith("s: no extractable text") for w in warnings)


def test_title_from_filename_strips_numbering_and_years() -> None:
    assert title_from_filename("05-Sigurnost programske podrske 2 i SDLC - 2026") == (
        "Sigurnost programske podrske 2 i SDLC"
    )
    assert title_from_filename("00. Uvod[8]") == "Uvod"


def test_course_file_round_trips_and_checks_page_ranges(tmp_path: Path) -> None:
    doc = ingested(tmp_path, "01 Uvod.pdf", make_pdf(deck(4, "U")), "u")
    course, _ = propose(config(tmp_path), [doc])
    (tmp_path / "course.yaml").write_text(dump_course(course, ["header"]), encoding="utf-8")
    loaded = load_course(tmp_path)
    assert loaded == course
    assert check_pages(course, {"u": doc}) == []

    data = yaml.safe_load((tmp_path / "course.yaml").read_text(encoding="utf-8"))
    data["units"][0]["sources"][0]["pages"] = 9  # a YAML integer, beyond the PDF
    data["units"][0]["sources"].append({"pdf": "missing", "pages": "1-2"})
    assert check_pages(CourseFile.model_validate(data), {"u": doc}) == [
        "unit 01: pages 9 exceed u (4 pages)",
        "unit 01: no ingested PDF named 'missing'",
    ]


Change = Callable[[dict[str, object]], None]


def _duplicate_unit(d: dict[str, object]) -> None:
    units = d["units"]
    assert isinstance(units, list)
    units.append(dict(units[0]))


def _unknown_cycle_unit(d: dict[str, object]) -> None:
    d["exam_cycles"] = [{"name": "MI", "units": ["07"]}]


def _backwards_range(d: dict[str, object]) -> None:
    d["units"] = [{"id": "01", "title": "Uvod", "sources": [{"pdf": "u", "pages": "5-2"}]}]


@pytest.mark.parametrize(
    ("change", "message"),
    [
        (_duplicate_unit, "duplicate unit ids"),
        (_unknown_cycle_unit, "unknown units"),
        (_backwards_range, "run backwards"),
    ],
)
def test_course_file_rejects_inconsistent_content(change: Change, message: str) -> None:
    data: dict[str, object] = {
        "version": "studio-course-v1",
        "course": {"name": "SRS", "code": "SRS"},
        "units": [{"id": "01", "title": "Uvod", "sources": [{"pdf": "u", "pages": "1-4"}]}],
    }
    change(data)
    with pytest.raises(ValueError, match=message):
        CourseFile.model_validate(data)


def test_config_requires_different_model_families_and_https() -> None:
    base: dict[str, object] = {
        "course": Course(name="SRS", code="SRS"),
        "sources": Sources(pdfs=["*.pdf"]),
        "providers": {"or": {"base_url": "https://openrouter.ai/api/v1", "api_key_env": "K"}},
        "stages": {
            "generate": {"provider": "or", "model": "qwen/qwen3.8-flash"},
            "verify": {"provider": "or", "model": "qwen/qwen3.8-max-0902"},
        },
    }
    with pytest.raises(ValueError, match="different model families"):
        StudioConfig.model_validate(base)
    insecure = base | {
        "providers": {"or": {"base_url": "http://openrouter.ai/api/v1", "api_key_env": "K"}},
        "stages": {},
    }
    with pytest.raises(ValueError, match="https URL ending in /v1"):
        StudioConfig.model_validate(insecure)


def test_template_keeps_windows_paths_and_quotes(tmp_path: Path) -> None:
    text = render_template("Kolegij 'test'", "SRS", [r"C:\faks\srs\pdfpreze\*.pdf"])
    (tmp_path / "studio.toml").write_text(text, encoding="utf-8")
    loaded = load_config(tmp_path)
    assert loaded.sources.pdfs == [r"C:\faks\srs\pdfpreze\*.pdf"]
    assert loaded.course.name == "Kolegij 'test'"
    assert loaded.stages["generate"].family != loaded.stages["verify"].family


def test_studio_folder_must_be_outside_the_repository(tmp_path: Path) -> None:
    ensure_outside_repo(tmp_path)
    with pytest.raises(StudioError, match="inside the ExamPrep repository"):
        ensure_outside_repo(Path(__file__).parent)


def test_cli_init_ingest_and_status(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    write(tmp_path / "pdfpreze" / "01. Uvod.pdf", make_pdf(deck(4, "Uvod")))
    write(tmp_path / "pdfpreze" / "02. AES.pdf", make_pdf(deck(5, "AES")))
    studio_dir = tmp_path / "studio"
    args = ["--name", "Sigurnost računalnih sustava", "--code", "SRS"]
    assert main(["init", str(studio_dir), *args, "--pdfs", "../pdfpreze/*.pdf"]) == 0
    assert main(["init", str(studio_dir), *args, "--pdfs", "x.pdf"]) == 2  # never overwrites

    assert main(["ingest", str(studio_dir)]) == 0
    assert main(["status", str(studio_dir)]) == 1  # course.yaml is not confirmed yet
    shutil.copy(studio_dir / "course.proposed.yaml", studio_dir / "course.yaml")
    assert main(["status", str(studio_dir)]) == 0
    out = capsys.readouterr().out
    assert "01 Uvod (4 pages)" in out and "02 AES (5 pages)" in out

    assert main(["ingest", str(studio_dir)]) == 0
    assert capsys.readouterr().out.count("unchanged") == 2
