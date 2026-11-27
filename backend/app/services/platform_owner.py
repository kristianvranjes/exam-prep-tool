"""The people who run the platform may manage every course, whatever their membership."""

from app.config import Settings
from app.models import User


def is_platform_owner(user: User) -> bool:
    """Whether `user` is listed in PLATFORM_OWNER_USER_IDS; nobody is until it is set.

    Callers ask this only after the normal checks fail, so it costs ordinary requests nothing.
    """
    return user.id in Settings().platform_owner_ids
