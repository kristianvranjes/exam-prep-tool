import shutil
from pathlib import Path

import pytest
from pdfgen import make_pdf

import studio.ocr as ocr
from studio.cli import main
from studio.config import StudioError
from studio.ingest import ingest_pdf, sha256_file
from studio.ocr import cached_pages, ocr_pages, tesseract_binary

SCANNED = [[], ["Prava stranica s tekstom koji nije sken."], []]


class FakeReader:
    """Stands in for Tesseract: 'reads' a page image by its file name."""

    def __init__(self) -> None:
        self.pages: list[str] = []

    def __call__(self, image: Path, lang: str) -> str:
        self.pages.append(image.stem)
        return f"Prevođenje stranice {int(image.stem[1:])} ({lang}).\nDrugi redak teksta.\f"


@pytest.fixture
def pdf(tmp_path: Path) -> Path:
    path = tmp_path / "pdf" / "skripta.pdf"
    path.parent.mkdir()
    path.write_bytes(make_pdf(SCANNED))
    return path


def test_ocr_text_replaces_empty_pages_and_triggers_a_fresh_ingest(
    tmp_path: Path, pdf: Path
) -> None:
    before = ingest_pdf(pdf, "skripta", tmp_path).doc
    assert before.count("no_text") == 2 and before.ocr_digest is None

    reader = FakeReader()
    flagged = [p.page for p in before.pages if "no_text" in p.flags]
    assert ocr_pages(pdf, "skripta", before.sha256, flagged, tmp_path, reader=reader) == 2

    after = ingest_pdf(pdf, "skripta", tmp_path)
    assert not after.skipped  # new OCR text means a fresh ingest
    doc = after.doc
    assert doc.count("no_text") == 0 and doc.count("ocr") == 2
    assert doc.pages[0].text.startswith("Prevođenje stranice 1 (hrv+eng).")
    assert "\f" not in doc.pages[2].text
    assert "Prava stranica" in doc.pages[1].text and "ocr" not in doc.pages[1].flags
    assert ingest_pdf(pdf, "skripta", tmp_path).skipped


def test_cached_pages_are_not_read_again_until_settings_change(tmp_path: Path, pdf: Path) -> None:
    sha = sha256_file(pdf)
    reader = FakeReader()
    ocr_pages(pdf, "s", sha, [1, 3], tmp_path, reader=reader)
    assert ocr_pages(pdf, "s", sha, [1, 3], tmp_path, reader=reader) == 0
    assert ocr_pages(pdf, "s", sha, [1, 2, 3], tmp_path, reader=reader) == 1
    assert reader.pages == ["p0001", "p0003", "p0002"]

    assert ocr_pages(pdf, "s", sha, [1], tmp_path, dpi=200, reader=reader) == 1
    assert sorted(cached_pages(tmp_path, "s", sha)) == [1]  # other settings start over
    assert cached_pages(tmp_path, "s", "0" * 64) == {}  # a different PDF never uses it


def test_cli_ocr_reads_flagged_pages(
    tmp_path: Path, pdf: Path, capsys: pytest.CaptureFixture[str], monkeypatch: pytest.MonkeyPatch
) -> None:
    reader = FakeReader()
    monkeypatch.setattr(ocr, "tesseract_reader", lambda: reader)
    studio_dir = tmp_path / "studio"
    args = ["--name", "SRS", "--code", "SRS", "--pdfs", "../pdf/*.pdf"]
    assert main(["init", str(studio_dir), *args]) == 0
    assert main(["ingest", str(studio_dir)]) == 0
    capsys.readouterr()

    assert main(["ocr", str(studio_dir)]) == 0
    out = capsys.readouterr().out
    assert "skripta: reading 2 pages" in out
    assert "no text on 2 -> 0 pages" in out
    assert main(["ocr", str(studio_dir), "--pdf", "nema"]) == 2


@pytest.mark.skipif(
    shutil.which("tesseract") is None and not ocr.WINDOWS_TESSERACT.is_file(),
    reason="Tesseract is not installed",
)
def test_real_tesseract_reads_a_rendered_page(tmp_path: Path) -> None:
    path = tmp_path / "plain.pdf"
    path.write_bytes(make_pdf([["Leksicka analiza grupira znakove u jedinke."]]))
    try:
        tesseract_binary()
    except StudioError:
        pytest.skip("Tesseract is not configured")
    ocr_pages(path, "plain", sha256_file(path), [1], tmp_path, lang="eng", jobs=1)
    text = cached_pages(tmp_path, "plain", sha256_file(path))[1]
    assert "analiza" in text and "jedinke" in text
