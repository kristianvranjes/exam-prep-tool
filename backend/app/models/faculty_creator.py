from datetime import datetime
from uuid import UUID

from sqlalchemy import DateTime, ForeignKey, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class FacultyCreator(Base):
    """Who added a faculty in the app. Seeded faculties have no row.

    Kept apart from `faculties` so removing an account never touches the faculty.
    """

    __tablename__ = "faculty_creators"
    faculty_id: Mapped[UUID] = mapped_column(
        ForeignKey("faculties.id", ondelete="CASCADE"), primary_key=True
    )
    user_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), index=True, nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
