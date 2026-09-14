from dataclasses import dataclass
from pathlib import Path

from markitdown import StreamInfo
from markitdown.converters import PdfConverter

from app.services.materials.chunking import normalize_markdown


@dataclass(frozen=True)
class ExtractedDocument:
    markdown: str


def extract_document(path: Path) -> ExtractedDocument:
    # Use MarkItDown's PDF converter directly, bypassing its ML format classifier.
    # No URL, archive, plugin or AI conversion paths are registered.
    converter = PdfConverter()
    with path.open("rb") as source:
        result = converter.convert(
            source, stream_info=StreamInfo(extension=".pdf", mimetype="application/pdf")
        )
    markdown = normalize_markdown(result.markdown)
    if not markdown or "\x00" in markdown:
        raise ValueError("No usable text")
    return ExtractedDocument(markdown)
