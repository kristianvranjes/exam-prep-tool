from sqlalchemy import func
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.models import User
from app.models.user_preference import UserPreference
from app.schemas.preferences import (
    DEFAULT_PREFERENCES,
    CustomColors,
    PreferencesBody,
    PreferencesResponse,
)


def to_response(row: UserPreference) -> PreferencesResponse:
    colors = None
    if row.custom_background and row.custom_text and row.custom_accent:
        colors = CustomColors(
            background=row.custom_background, text=row.custom_text, accent=row.custom_accent
        )
    return PreferencesResponse.model_validate(
        {
            "palette": row.palette,
            "font_scale_percent": row.font_scale_percent,
            "answer_markers": row.answer_markers,
            "custom_colors": colors,
            "updated_at": row.updated_at,
        }
    )


def get_preferences(db: Session, user: User) -> PreferencesResponse:
    row = db.get(UserPreference, user.id)
    return DEFAULT_PREFERENCES if row is None else to_response(row)


def save_preferences(db: Session, user: User, body: PreferencesBody) -> PreferencesResponse:
    """Replace the user's preferences; saving twice with the same body gives the same result."""
    colors = body.custom_colors
    values = {
        "palette": body.palette,
        "font_scale_percent": body.font_scale_percent,
        "answer_markers": body.answer_markers,
        "custom_background": colors.background if colors else None,
        "custom_text": colors.text if colors else None,
        "custom_accent": colors.accent if colors else None,
    }
    statement = insert(UserPreference).values(user_id=user.id, **values)
    row = db.execute(
        statement.on_conflict_do_update(
            index_elements=[UserPreference.user_id],
            set_={**values, "updated_at": func.now()},
        ).returning(UserPreference)
    ).scalar_one()
    db.commit()
    return to_response(row)
