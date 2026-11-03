from datetime import UTC, datetime
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


def load_session(token: str | None, settings: Settings) -> tuple[UUID, datetime] | None:
    """Return the user id and signing time of a valid, unexpired session token."""
    if not token:
        return None
    try:
        payload, issued_at = URLSafeTimedSerializer(
            settings.session_secret, salt="auth-session"
        ).loads(token, max_age=settings.session_max_age_seconds, return_timestamp=True)
        return UUID(payload["user_id"]), issued_at
    except (BadSignature, SignatureExpired, KeyError, TypeError, ValueError):
        return None


def read_session(token: str | None, settings: Settings) -> UUID | None:
    session = load_session(token, settings)
    return session[0] if session else None


def session_needs_renewal(
    issued_at: datetime, settings: Settings, now: datetime | None = None
) -> bool:
    """Sliding sessions: a valid token is re-issued once it is half way to expiry."""
    age = (now or datetime.now(UTC)) - issued_at
    return age.total_seconds() >= settings.session_max_age_seconds / 2
