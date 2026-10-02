"""Operator maintenance: python -m app.storage_cleanup [--batch-size 100]."""

import argparse
from collections.abc import Sequence

from sqlalchemy import func, select


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Retry pending material-source cleanup")
    parser.add_argument("--batch-size", type=int, default=100)
    args = parser.parse_args(argv)
    try:
        # Database initialization validates Settings at import time. Keep imports
        # inside the safe boundary so configuration errors cannot print a traceback.
        from app.config import Settings
        from app.database import SessionLocal
        from app.models.material_storage_cleanup import MaterialStorageCleanup
        from app.services.materials.cleanup import MAX_BATCH_SIZE, cleanup_sources
        from app.services.materials.storage import LocalMaterialStorage

        if not 1 <= args.batch_size <= MAX_BATCH_SIZE:
            parser.error("--batch-size must be between 1 and 1000")
        settings = Settings()
        result = cleanup_sources(
            SessionLocal,
            LocalMaterialStorage(settings.material_storage_dir),
            batch_size=args.batch_size,
        )
        with SessionLocal() as db:
            remaining = db.scalar(select(func.count()).select_from(MaterialStorageCleanup)) or 0
    except Exception:
        print("Cleanup unavailable; retry later.")
        return 1
    print(f"Cleaned: {result.cleaned}; failed: {result.failed}; pending: {remaining}")
    return 1 if result.failed or remaining else 0


if __name__ == "__main__":
    raise SystemExit(main())
