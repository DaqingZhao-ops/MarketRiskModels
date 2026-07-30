from collections.abc import Generator
from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect
from sqlalchemy.engine import Engine
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


def upgrade_sqlite_schema(db_engine: Engine, database_url: str) -> None:
    """Upgrade file-backed SQLite, including databases predating Alembic."""
    if database_url == "sqlite:///:memory:":
        Base.metadata.create_all(bind=db_engine)
        return

    tables = set(inspect(db_engine).get_table_names())
    backend_root = Path(__file__).resolve().parents[2]
    alembic_config = Config(str(backend_root / "alembic.ini"))
    alembic_config.set_main_option("script_location", str(backend_root / "alembic"))
    alembic_config.attributes["database_url"] = database_url

    if "market_prices" in tables and "alembic_version" not in tables:
        # Older desktop releases created tables directly from SQLAlchemy.
        # Mark only the schema that is demonstrably present, then let Alembic
        # apply every later migration normally.
        legacy_revision = "0002" if "portfolio_versions" in tables else "0001"
        command.stamp(alembic_config, legacy_revision)
    command.upgrade(alembic_config, "head")


def get_session() -> Generator[Session, None, None]:
    with SessionLocal() as session:
        yield session
