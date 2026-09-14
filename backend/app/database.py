from sqlalchemy import Engine, create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from app.config import Settings


class Base(DeclarativeBase):
    pass


from app.models import course, course_membership, user  # noqa: E402,F401


def make_engine(settings: Settings) -> Engine:
    return create_engine(
        settings.database_url, pool_pre_ping=True, connect_args={"connect_timeout": 3}
    )


engine = make_engine(Settings())
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
