from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.config import Settings
from app.dependencies import get_current_user, get_db, write_session_cookie
from app.models import User
from app.schemas.user import LoginRequest, UserCreate, UserResponse
from app.services.auth import hash_password, normalize_email, verify_password

router = APIRouter(prefix="/auth", tags=["auth"])

THROTTLED_RESPONSE: dict[int | str, dict[str, object]] = {
    429: {
        "description": "Authentication attempt limit reached; retry after the indicated seconds.",
        "headers": {"Retry-After": {"schema": {"type": "integer", "minimum": 1}}},
    }
}


def set_session_cookie(response: Response, user: User) -> None:
    write_session_cookie(response, user.id, Settings())


@router.post(
    "/register",
    response_model=UserResponse,
    status_code=status.HTTP_201_CREATED,
    responses=THROTTLED_RESPONSE,
)
def register(data: UserCreate, response: Response, db: Session = Depends(get_db)) -> User:
    user = User(
        email=normalize_email(str(data.email)),
        password_hash=hash_password(data.password),
        display_name=data.display_name.strip(),
    )
    db.add(user)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=409, detail="An account with that email already exists"
        ) from None
    db.refresh(user)
    set_session_cookie(response, user)
    return user


@router.post("/login", response_model=UserResponse, responses=THROTTLED_RESPONSE)
def login(data: LoginRequest, response: Response, db: Session = Depends(get_db)) -> User:
    user = db.scalar(select(User).where(User.email == normalize_email(str(data.email))))
    if user is None or not verify_password(data.password, user.password_hash) or not user.is_active:
        raise HTTPException(status_code=401, detail="Invalid email or password")
    set_session_cookie(response, user)
    return user


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(response: Response) -> None:
    settings = Settings()
    response.delete_cookie(
        settings.session_cookie_name,
        path="/",
        httponly=True,
        secure=settings.session_cookie_secure,
        samesite=settings.session_cookie_samesite,
    )


@router.get("/me", response_model=UserResponse)
def me(user: User = Depends(get_current_user)) -> User:
    return user
