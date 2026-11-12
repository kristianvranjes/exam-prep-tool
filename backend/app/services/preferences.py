from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.models import User
from app.models.user_preferences import UserPreferences
from app.schemas.preferences import Preferences


def get_preferences(db: Session, user: User) -> Preferences:
    """The stored settings, or the defaults for a user who never saved any."""
    row = db.get(UserPreferences, user.id)
    return Preferences() if row is None else Preferences.model_validate(row.data)


def save_preferences(db: Session, user: User, preferences: Preferences) -> Preferences:
    data = preferences.model_dump(mode="json")
    statement = insert(UserPreferences).values(user_id=user.id, data=data)
    db.execute(
        statement.on_conflict_do_update(
            index_elements=[UserPreferences.user_id],
            set_={"data": data, "updated_at": statement.excluded.updated_at},
        )
    )
    db.commit()
    return preferences
