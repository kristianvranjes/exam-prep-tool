"""Build folder layout and atomic JSON writes."""

import json
from pathlib import Path

from pydantic import BaseModel


def unit_dir(studio_dir: Path, unit_id: str) -> Path:
    return studio_dir / "build" / "units" / unit_id


def write_json(path: Path, data: BaseModel | dict[str, object]) -> None:
    """Write through a temporary file, so an interrupted run never leaves half a file."""
    payload = data.model_dump(mode="json") if isinstance(data, BaseModel) else data
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8")
    tmp.replace(path)
