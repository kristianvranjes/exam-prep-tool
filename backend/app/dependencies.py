from collections.abc import Generator
from uuid import UUID

from fastapi import Depends, HTTPException, Request, Response, status
from sqlalchemy.orm import Session

from app.config import Settings
from app.database import SessionLocal
from app.models import User
from app.services.auth import create_session, load_session, session_needs_renewal


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def write_session_cookie(response: Response, user_id: UUID, settings: Settings) -> None:
    """Issue the session cookie; login, register and renewal share these attributes."""
    response.set_cookie(
        settings.session_cookie_name,
        create_session(user_id, settings),
        max_age=settings.session_max_age_seconds,
        httponly=True,
        secure=settings.session_cookie_secure,
        samesite=settings.session_cookie_samesite,
        path="/",
    )


def get_current_user(request: Request, response: Response, db: Session = Depends(get_db)) -> User:
    settings = Settings()
    session = load_session(request.cookies.get(settings.session_cookie_name), settings)
    if session is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required"
        )
    user_id, issued_at = session
    user = db.get(User, user_id)
    if user is None or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required"
        )
    # FastAPI copies these headers onto the endpoint's response, so an active student's
    # session slides forward. Endpoints that fail or return their own Response object
    # (204 deletes) skip it; the next ordinary authenticated request renews instead.
    if session_needs_renewal(issued_at, settings):
        write_session_cookie(response, user.id, settings)
    return user
