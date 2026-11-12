from datetime import datetime
from enum import StrEnum
from typing import TYPE_CHECKING
from uuid import UUID, uuid4

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

if TYPE_CHECKING:
    from app.models.course import Course
    from app.models.user import User


class MembershipRole(StrEnum):
    OWNER = "OWNER"
    MEMBER = "MEMBER"


class MembershipStatus(StrEnum):
    ACTIVE = "ACTIVE"
    FINISHED = "FINISHED"


class CourseMembership(Base):
    __tablename__ = "course_memberships"
    __table_args__ = (
        UniqueConstraint("course_id", "user_id", name="uq_course_membership_course_user"),
        CheckConstraint("status IN ('ACTIVE', 'FINISHED')", name="ck_course_membership_status"),
        Index("ix_course_memberships_user_id", "user_id"),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    course_id: Mapped[UUID] = mapped_column(
        ForeignKey("courses.id", ondelete="CASCADE"), index=True
    )
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    role: Mapped[str] = mapped_column(String(10))
    # FINISHED moves the course to the student's "Završeni" list; it changes no access.
    status: Mapped[str] = mapped_column(String(10), server_default="ACTIVE")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    course: Mapped["Course"] = relationship(back_populates="memberships")
    user: Mapped["User"] = relationship(back_populates="memberships")
