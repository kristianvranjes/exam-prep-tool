"""Pure deterministic Markdown section parsing and character chunking."""

import re
from dataclasses import dataclass


@dataclass(frozen=True)
class Section:
    ordinal: int
    title: str | None
    level: int | None
    content: str


@dataclass(frozen=True)
class Chunk:
    ordinal: int
    section_ordinal: int
    content: str


def normalize_markdown(text: str) -> str:
    return text.replace("\r\n", "\n").replace("\r", "\n").strip()


def detect_sections(markdown: str) -> list[Section]:
    sections: list[Section] = []
    lines: list[str] = []
    title: str | None = None
    level: int | None = None
    fence: str | None = None

    def flush() -> None:
        content = "\n".join(lines).strip()
        if content:
            sections.append(Section(len(sections), title, level, content))

    for line in normalize_markdown(markdown).splitlines():
        fence_match = re.match(r"^ {0,3}(`{3,}|~{3,})", line)
        if fence_match:
            marker = fence_match.group(1)
            if fence is None:
                fence = marker
            elif marker[0] == fence[0] and len(marker) >= len(fence):
                fence = None
            lines.append(line)
            continue
        heading = re.match(r"^ {0,3}(#{1,6})(?:[ \t]+(.*)|$)", line) if fence is None else None
        if heading:
            flush()
            lines = []
            title = re.sub(r"[ \t]+#+[ \t]*$", "", heading.group(2) or "").strip()
            level = len(heading.group(1))
        lines.append(line)
    flush()
    return sections


def chunk_sections(sections: list[Section], target: int = 2500, overlap: int = 250) -> list[Chunk]:
    if target < 2 or not 0 <= overlap < target:
        raise ValueError("Require target >= 2 and 0 <= overlap < target")
    chunks: list[Chunk] = []
    for section in sections:
        text = section.content
        start = 0
        while start < len(text):
            end = min(start + target, len(text))
            if end < len(text):
                lower = start + max(target // 2, overlap + 1)
                for delimiter in ("\n\n", "\n", " "):
                    boundary = text.rfind(delimiter, lower, end)
                    if boundary != -1:
                        end = boundary + len(delimiter)
                        break
            content = text[start:end].strip()
            if content:
                chunks.append(Chunk(len(chunks), section.ordinal, content))
            if end == len(text):
                break
            start = max(start + 1, end - overlap)
    return chunks
