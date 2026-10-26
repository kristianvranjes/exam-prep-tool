from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import DateTime, ForeignKey, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class QuestionFavorite(Base):
    """A student's private favorite on a source question; attempts and grades never read it."""

    __tablename__ = "question_favorites"
    __table_args__ = (
        UniqueConstraint("user_id", "question_id", name="uq_question_favorite_user_question"),
    )
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    # Deleting the question removes the favorite; archiving keeps it.
    question_id: Mapped[UUID] = mapped_column(
        ForeignKey("questions.id", ondelete="CASCADE"), index=True
    )
    # Kept on repeated favorites, so FAVORITES sessions order by the first time.
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
