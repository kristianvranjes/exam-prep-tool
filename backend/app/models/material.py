from datetime import datetime
from enum import StrEnum
from uuid import UUID, uuid4

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class MaterialStatus(StrEnum):
    UPLOADED = "UPLOADED"
    PROCESSING = "PROCESSING"
    READY = "READY"
    FAILED = "FAILED"


class Material(Base):
    __tablename__ = "materials"
    __table_args__ = (
        CheckConstraint(
            "status IN ('UPLOADED','PROCESSING','READY','FAILED')", name="ck_material_status"
        ),
        CheckConstraint("file_size_bytes > 0", name="ck_material_size"),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    course_id: Mapped[UUID] = mapped_column(
        ForeignKey("courses.id", ondelete="CASCADE"), index=True
    )
    uploaded_by_user_id: Mapped[UUID] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), index=True
    )
    original_filename: Mapped[str] = mapped_column(String(255))
    media_type: Mapped[str] = mapped_column(String(100))
    file_size_bytes: Mapped[int]
    storage_key: Mapped[str] = mapped_column(String(100), unique=True)
    status: Mapped[str] = mapped_column(
        String(20), default=MaterialStatus.UPLOADED.value, index=True
    )
    extracted_markdown: Mapped[str | None] = mapped_column(Text)
    processing_error: Mapped[str | None] = mapped_column(String(300))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
