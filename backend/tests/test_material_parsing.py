from io import BytesIO

import pytest
from pdf_fixture import make_pdf

from app.services.materials.chunking import chunk_sections, detect_sections, normalize_markdown
from app.services.materials.extraction import extract_document
from app.services.materials.storage import LocalMaterialStorage


def test_sections_preserve_preamble_and_heading_hierarchy():
    sections = detect_sections("Intro\r\n\r\n# One\r\nBody\r\n## Two\r\nMore")
    assert [s.ordinal for s in sections] == [0, 1, 2]
    assert [s.level for s in sections] == [None, 1, 2]
    assert [s.title for s in sections] == [None, "One", "Two"]
    assert sections[0].content == "Intro"
    assert sections[2].content == "## Two\nMore"
    assert normalize_markdown(" \rHello\r\nworld\r ") == "Hello\nworld"


def test_no_headings_short_and_empty():
    sections = detect_sections("Plain text")
    assert len(sections) == 1
    assert sections[0].title is None
    assert [c.content for c in chunk_sections(sections)] == ["Plain text"]
    assert chunk_sections(detect_sections(" \n")) == []


def test_fenced_headings_are_content():
    sections = detect_sections("# Real\n\n```md\n## Code\n```\n## Next")
    assert [s.title for s in sections] == ["Real", "Next"]
    assert "## Code" in sections[0].content


def test_chunk_order_overlap_and_lossless_hard_cuts():
    text = "abcdefghijklmnopqrstuvwxyz" * 10
    sections = detect_sections(text)
    chunks = chunk_sections(sections, 40, 7)
    assert len(chunks) > 1
    assert [c.ordinal for c in chunks] == list(range(len(chunks)))
    assert all(0 < len(c.content) <= 40 for c in chunks)
    assert chunks == chunk_sections(sections, 40, 7)
    assert all(a.content[-7:] == b.content[:7] for a, b in zip(chunks, chunks[1:], strict=False))
    assert chunks[0].content + "".join(c.content[7:] for c in chunks[1:]) == text


def test_chunk_paragraph_boundaries_and_section_links():
    sections = detect_sections("# A\n" + "a" * 30 + "\n\n" + "b" * 35 + "\n# B\nshort")
    chunks = chunk_sections(sections, 50, 0)
    assert chunks[0].content == "# A\n" + "a" * 30
    assert chunks[-1].section_ordinal == 1
    assert chunks[-1].content == "# B\nshort"
    with pytest.raises(ValueError):
        chunk_sections(sections, 10, 10)


def test_real_markitdown_pdf_and_storage(tmp_path):
    storage = LocalMaterialStorage(tmp_path)
    saved = storage.save(BytesIO(make_pdf()), 10000)
    assert saved.size == len(make_pdf())
    extracted = extract_document(storage.path(saved.key))
    assert "ExamPrep sample material" in extracted.markdown
    with pytest.raises(ValueError):
        storage.path("../outside.pdf")
    storage.delete(saved.key)
    assert not list(tmp_path.iterdir())
