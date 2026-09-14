"""Local storage keys are generated internally; filenames are metadata only."""

import re
from dataclasses import dataclass
from pathlib import Path
from typing import BinaryIO, Protocol
from uuid import uuid4

from fastapi import HTTPException


@dataclass(frozen=True)
class StoredFile:
    key: str
    size: int


class MaterialStorage(Protocol):
    def save(self, source: BinaryIO, max_bytes: int) -> StoredFile: ...
    def path(self, key: str) -> Path: ...
    def delete(self, key: str) -> None: ...


class LocalMaterialStorage:
    def __init__(self, root: Path):
        self.root = root.resolve()

    def path(self, key: str) -> Path:
        if not re.fullmatch(r"[0-9a-f]{32}\.pdf", key):
            raise ValueError("Invalid storage key")
        path = (self.root / key).resolve()
        if path.parent != self.root:
            raise ValueError("Storage path escapes root")
        return path

    def save(self, source: BinaryIO, max_bytes: int) -> StoredFile:
        self.root.mkdir(parents=True, exist_ok=True)
        key = f"{uuid4().hex}.pdf"
        path = self.path(key)
        size = 0
        try:
            with path.open("xb") as output:
                while data := source.read(min(65536, max_bytes + 1 - size)):
                    size += len(data)
                    if size > max_bytes:
                        raise HTTPException(413, "PDF exceeds upload limit")
                    output.write(data)
            if size == 0:
                raise HTTPException(400, "PDF must not be empty")
            with path.open("rb") as stored:
                if not stored.read(5).startswith(b"%PDF-"):
                    raise HTTPException(415, "File must contain a PDF")
            return StoredFile(key, size)
        except Exception:
            path.unlink(missing_ok=True)
            raise

    def delete(self, key: str) -> None:
        self.path(key).unlink(missing_ok=True)


def validate_filename(filename: str | None, content_type: str | None) -> str:
    name = (filename or "").replace("\\", "/").rsplit("/", 1)[-1]
    name = "".join(c for c in name if c.isprintable()).strip()
    if not name.lower().endswith(".pdf") or content_type != "application/pdf":
        raise HTTPException(415, "Only application/pdf files with a .pdf extension are supported")
    if len(name) > 255:
        raise HTTPException(400, "Filename is too long")
    return name
