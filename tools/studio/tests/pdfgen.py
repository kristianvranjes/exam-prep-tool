"""Minimal PDF writer for tests: text pages and an optional one-level outline."""


def _escape(text: str) -> str:
    return text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def make_pdf(pages: list[list[str]], outline: list[tuple[str, int]] | None = None) -> bytes:
    """Pages are lists of lines; outline entries are (title, 1-based page)."""
    outline = outline or []
    count = len(pages)
    page_ids = [4 + 2 * i for i in range(count)]
    root_id = 4 + 2 * count
    item_ids = [root_id + 1 + k for k in range(len(outline))]

    objects: dict[int, str] = {}
    catalog = "<< /Type /Catalog /Pages 2 0 R"
    if outline:
        catalog += f" /Outlines {root_id} 0 R /PageMode /UseOutlines"
    objects[1] = catalog + " >>"
    kids = " ".join(f"{p} 0 R" for p in page_ids)
    objects[2] = f"<< /Type /Pages /Kids [{kids}] /Count {count} >>"
    objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"
    for page_id, lines in zip(page_ids, pages, strict=True):
        shown = " T* ".join(f"({_escape(line)}) Tj" for line in lines)
        stream = f"BT /F1 12 Tf 14 TL 72 760 Td {shown} ET" if lines else ""
        objects[page_id] = (
            "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
            f"/Resources << /Font << /F1 3 0 R >> >> /Contents {page_id + 1} 0 R >>"
        )
        length = len(stream.encode("latin-1"))
        objects[page_id + 1] = f"<< /Length {length} >>\nstream\n{stream}\nendstream"
    if outline:
        objects[root_id] = (
            f"<< /Type /Outlines /First {item_ids[0]} 0 R /Last {item_ids[-1]} 0 R "
            f"/Count {len(outline)} >>"
        )
        for k, (title, page) in enumerate(outline):
            links = ""
            if k > 0:
                links += f" /Prev {item_ids[k - 1]} 0 R"
            if k < len(outline) - 1:
                links += f" /Next {item_ids[k + 1]} 0 R"
            objects[item_ids[k]] = (
                f"<< /Title ({_escape(title)}) /Parent {root_id} 0 R "
                f"/Dest [{page_ids[page - 1]} 0 R /Fit]{links} >>"
            )

    out = bytearray(b"%PDF-1.4\n")
    offsets = {}
    for number in sorted(objects):
        offsets[number] = len(out)
        out += f"{number} 0 obj\n{objects[number]}\nendobj\n".encode("latin-1")
    xref = len(out)
    size = max(objects) + 1
    out += f"xref\n0 {size}\n0000000000 65535 f \n".encode()
    for number in range(1, size):
        out += f"{offsets[number]:010d} 00000 n \n".encode()
    out += f"trailer\n<< /Size {size} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
    return bytes(out)
