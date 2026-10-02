"""DB-authorized, idempotent cleanup of deleted material sources."""

from collections.abc import Callable, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from uuid import UUID, uuid4

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.material_storage_cleanup import MaterialStorageCleanup
from app.services.materials.storage import MaterialStorage

MAX_ATTEMPT_COUNT = 2_147_483_647
MAX_BATCH_SIZE = 1000


@dataclass
class CleanupResult:
    cleaned: int = 0
    failed: int = 0


def queue_sources(db: Session, storage_keys: Sequence[str]) -> list[UUID]:
    """Caller commits these intents atomically with domain deletion; never delete here."""
    ids = []
    for key in storage_keys:
        cleanup_id = uuid4()
        db.add(MaterialStorageCleanup(id=cleanup_id, storage_key=key))
        ids.append(cleanup_id)
    return ids


def cleanup_sources(
    sessions: Callable[[], Session],
    storage: MaterialStorage,
    *,
    cleanup_ids: Sequence[UUID] | None = None,
    batch_size: int = 100,
) -> CleanupResult:
    """Fresh sessions can only read committed intents, never a caller's pending writes.

    Each intent is locked until its outcome commits. Concurrent processors skip
    locked work; a crash/DB failure leaves the intent for missing-safe retry.
    """
    if not 1 <= batch_size <= MAX_BATCH_SIZE:
        raise ValueError("Batch size must be between 1 and 1000")
    result = CleanupResult()
    if cleanup_ids is None:
        try:
            with sessions() as db:
                cleanup_ids = list(
                    db.scalars(
                        select(MaterialStorageCleanup.id)
                        .order_by(MaterialStorageCleanup.created_at, MaterialStorageCleanup.id)
                        .limit(batch_size)
                    )
                )
        except Exception:
            result.failed += 1
            return result
    for cleanup_id in cleanup_ids:
        try:
            with sessions() as db:
                row = db.scalar(
                    select(MaterialStorageCleanup)
                    .where(MaterialStorageCleanup.id == cleanup_id)
                    .with_for_update(skip_locked=True)
                )
                if row is None:
                    continue
                try:
                    storage.delete(row.storage_key)
                except Exception:
                    row.attempt_count = min(row.attempt_count + 1, MAX_ATTEMPT_COUNT)
                    row.last_attempt_at = datetime.now(UTC)
                    db.commit()
                    result.failed += 1
                else:
                    db.delete(row)
                    db.commit()
                    result.cleaned += 1
        except Exception:
            # Includes physical success followed by DB failure. Closing the session
            # rolls back the row removal; the next attempt safely sees a missing file.
            result.failed += 1
    return result
