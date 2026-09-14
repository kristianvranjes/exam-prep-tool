from uuid import UUID

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer

from app.config import Settings

password_hasher = PasswordHasher()


def normalize_email(email: str) -> str:
    return email.strip().casefold()


def hash_password(password: str) -> str:
    return password_hasher.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return password_hasher.verify(password_hash, password)
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False


def create_session(user_id: UUID, settings: Settings) -> str:
    return URLSafeTimedSerializer(settings.session_secret, salt="auth-session").dumps(
        {"user_id": str(user_id)}
    )


def read_session(token: str | None, settings: Settings) -> UUID | None:
    if not token:
        return None
    try:
        payload = URLSafeTimedSerializer(settings.session_secret, salt="auth-session").loads(
            token, max_age=settings.session_max_age_seconds
        )
        return UUID(payload["user_id"])
    except (BadSignature, SignatureExpired, KeyError, TypeError, ValueError):
        return None
