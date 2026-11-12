from datetime import datetime
from uuid import UUID

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, SmallInteger, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base

PALETTES = ("dark", "light", "night", "contrast", "custom", "system")
FONT_SCALES = (90, 100, 115, 130)
ANSWER_MARKERS = ("letters", "shapes")


class UserPreference(Base):
    """How the interface looks for one user. No row means the defaults."""

    __tablename__ = "user_preferences"
    __table_args__ = (
        CheckConstraint(
            "palette IN ('dark', 'light', 'night', 'contrast', 'custom', 'system')",
            name="ck_user_preferences_palette",
        ),
        CheckConstraint(
            "font_scale_percent IN (90, 100, 115, 130)", name="ck_user_preferences_font_scale"
        ),
        CheckConstraint(
            "answer_markers IN ('letters', 'shapes')", name="ck_user_preferences_markers"
        ),
        CheckConstraint(
            "(custom_background IS NULL AND custom_text IS NULL AND custom_accent IS NULL) "
            "OR (custom_background IS NOT NULL AND custom_text IS NOT NULL "
            "AND custom_accent IS NOT NULL "
            "AND custom_background ~ '^#[0-9a-f]{6}$' AND custom_text ~ '^#[0-9a-f]{6}$' "
            "AND custom_accent ~ '^#[0-9a-f]{6}$')",
            name="ck_user_preferences_custom",
        ),
        CheckConstraint(
            "palette <> 'custom' OR custom_background IS NOT NULL",
            name="ck_user_preferences_custom_palette",
        ),
    )

    user_id: Mapped[UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    palette: Mapped[str] = mapped_column(String(10), server_default="dark")
    font_scale_percent: Mapped[int] = mapped_column(SmallInteger, server_default="100")
    answer_markers: Mapped[str] = mapped_column(String(7), server_default="letters")
    custom_background: Mapped[str | None] = mapped_column(String(7))
    custom_text: Mapped[str | None] = mapped_column(String(7))
    custom_accent: Mapped[str | None] = mapped_column(String(7))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
