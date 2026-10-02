from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import CheckConstraint, DateTime, Index, String, func, text
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class MaterialStorageCleanup(Base):
    __tablename__ = "material_storage_cleanups"
    __table_args__ = (
        CheckConstraint("attempt_count >= 0", name="ck_material_storage_cleanup_attempts"),
        Index("ix_material_storage_cleanups_queue", "created_at", "id"),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    storage_key: Mapped[str] = mapped_column(String(100), unique=True)
    attempt_count: Mapped[int] = mapped_column(server_default=text("0"))
    last_attempt_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
