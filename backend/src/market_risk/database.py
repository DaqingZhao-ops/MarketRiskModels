from collections.abc import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker
from sqlalchemy.pool import StaticPool

from .config import get_settings


class Base(DeclarativeBase):
    pass


settings = get_settings()
settings.ensure_sqlite_directory()

connect_args = {"check_same_thread": False} if settings.database_url.startswith("sqlite") else {}
engine_options: dict[str, object] = {
    "connect_args": connect_args,
    "pool_pre_ping": True,
}
if settings.database_url == "sqlite:///:memory:":
    engine_options["poolclass"] = StaticPool
engine = create_engine(settings.database_url, **engine_options)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def get_session() -> Generator[Session, None, None]:
    with SessionLocal() as session:
        yield session
