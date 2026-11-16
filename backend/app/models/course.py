from datetime import datetime
from typing import TYPE_CHECKING
from uuid import UUID, uuid4

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, SmallInteger, String, Text, func, true
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

if TYPE_CHECKING:
    from app.models.course_membership import CourseMembership
    from app.models.user import User


class Course(Base):
    __tablename__ = "courses"
    __table_args__ = (
        CheckConstraint(
            "year_of_study IS NULL OR year_of_study BETWEEN 1 AND 6", name="ck_course_year_of_study"
        ),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    faculty_id: Mapped[UUID] = mapped_column(
        ForeignKey("faculties.id", ondelete="RESTRICT"), index=True
    )
    is_active: Mapped[bool] = mapped_column(server_default=true())
    name: Mapped[str] = mapped_column(String(150))
    code: Mapped[str | None] = mapped_column(String(50), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Set by a faculty moderator; courses made before it existed have none.
    year_of_study: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)
    created_by_user_id: Mapped[UUID] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), index=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    creator: Mapped["User"] = relationship(back_populates="courses")
    memberships: Mapped[list["CourseMembership"]] = relationship(
        back_populates="course", cascade="all, delete-orphan", passive_deletes=True
    )
