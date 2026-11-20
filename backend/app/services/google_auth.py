"""Sign in with a Google ID token: verify it, then find, link or create the account."""

import secrets
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from google.auth import exceptions
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import User
from app.services.auth import hash_password, normalize_email

GOOGLE_ISSUERS = ("accounts.google.com", "https://accounts.google.com")
CERT_TIMEOUT_SECONDS = 10
CLOCK_SKEW_SECONDS = 10

# Takes the credential and the expected audience; returns the token's claims once its
# signature, issuer, audience and expiry are checked. Tests replace it; it never logs the token.
GoogleVerifier = Callable[[str, str], Mapping[str, Any]]


class GoogleTokenError(Exception):
    """The credential is not a valid Google ID token for this app."""


class GoogleUnavailableError(Exception):
    """Google's signing keys could not be fetched."""


class AccountDisabledError(Exception):
    pass


class GoogleAccountConflictError(Exception):
    """The e-mail belongs to an account already linked to a different Google account."""


@dataclass(frozen=True)
class GoogleIdentity:
    sub: str
    email: str
    name: str


class _BoundedRequest(google_requests.Request):
    """Google's transport waits up to two minutes by default; a sign-in should not."""

    def __call__(self, url: str, method: str = "GET", *args: Any, **kwargs: Any) -> Any:
        kwargs["timeout"] = CERT_TIMEOUT_SECONDS
        return super().__call__(url, method, *args, **kwargs)  # type: ignore[no-untyped-call]


def verify_with_google(credential: str, client_id: str) -> Mapping[str, Any]:
    """Check the token against Google's published keys (fetched over HTTPS)."""
    try:
        claims: Mapping[str, Any] = id_token.verify_oauth2_token(  # type: ignore[no-untyped-call]
            credential,
            _BoundedRequest(),
            audience=client_id,
            clock_skew_in_seconds=CLOCK_SKEW_SECONDS,
        )
    except exceptions.TransportError:
        raise GoogleUnavailableError from None
    except (ValueError, exceptions.GoogleAuthError):
        # Google's message may quote the token; it is dropped on purpose.
        raise GoogleTokenError from None
    return claims


def identity_from_claims(claims: Mapping[str, Any], client_id: str) -> GoogleIdentity:
    """Apply this app's rules to verified claims (repeated here so a replaced verifier is held
    to them too)."""
    audience = claims.get("aud")
    audiences = audience if isinstance(audience, list) else [audience]
    sub = claims.get("sub")
    email = claims.get("email")
    if (
        claims.get("iss") not in GOOGLE_ISSUERS
        or client_id not in audiences
        or claims.get("email_verified") not in (True, "true")
        or not isinstance(sub, str)
        or not sub
        or len(sub) > 255
        or not isinstance(email, str)
        or "@" not in email
        or len(email) > 320
    ):
        raise GoogleTokenError
    email = normalize_email(email)
    name = claims.get("name")
    name = name.strip()[:100].strip() if isinstance(name, str) else ""
    return GoogleIdentity(sub=sub, email=email, name=name or email.split("@", 1)[0][:100])


def _cutoff_now() -> datetime:
    # Session tokens carry whole seconds; a cut-off on a whole second keeps the cookie issued
    # right after linking (same second) valid while every earlier second is refused.
    return datetime.now(UTC).replace(microsecond=0)


def _find_or_link(db: Session, identity: GoogleIdentity) -> User | None:
    user = db.scalar(select(User).where(User.google_sub == identity.sub))
    if user is not None:
        if not user.is_active:
            raise AccountDisabledError
        return user
    user = db.scalar(select(User).where(User.email == identity.email))
    if user is None:
        return None
    if not user.is_active:
        raise AccountDisabledError
    if user.google_sub is not None:
        raise GoogleAccountConflictError
    # Whoever opened the account with a password before the owner of the address linked it
    # loses every session signed until now.
    user.google_sub = identity.sub
    user.sessions_valid_after = _cutoff_now()
    db.commit()
    return user


def sign_in_with_google(db: Session, identity: GoogleIdentity) -> User:
    """Return the active account for this Google identity, linking or creating it."""
    user = _find_or_link(db, identity)
    if user is not None:
        return user
    user = User(
        email=identity.email,
        google_sub=identity.sub,
        # A random secret nobody knows: the account has no usable password.
        password_hash=hash_password(secrets.token_urlsafe(32)),
        display_name=identity.name,
    )
    db.add(user)
    try:
        db.commit()
    except IntegrityError:
        # A simultaneous first sign-in (or registration) created the row; use that one.
        db.rollback()
        existing = _find_or_link(db, identity)
        if existing is None:
            raise
        return existing
    db.refresh(user)
    return user
