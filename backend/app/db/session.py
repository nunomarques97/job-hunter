"""Engine, session factory and schema creation."""
from __future__ import annotations

from collections.abc import Iterator

from sqlalchemy import create_engine, event
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from ..core.config import get_settings
from .base import Base

_settings = get_settings()

_connect_args = {"check_same_thread": False} if _settings.resolved_database_url.startswith("sqlite") else {}

engine: Engine = create_engine(
    _settings.resolved_database_url,
    connect_args=_connect_args,
    future=True,
    pool_pre_ping=True,
)


@event.listens_for(engine, "connect")
def _sqlite_pragmas(dbapi_connection, _record) -> None:
    """SQLite needs foreign keys switched on per connection, and WAL keeps the
    desktop UI readable while a background automation run writes."""
    if not _settings.resolved_database_url.startswith("sqlite"):
        return
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA synchronous=NORMAL")
    cursor.close()


SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)


def init_db() -> None:
    """Create every table. Importing the models module registers them on ``Base``."""
    from .. import models  # noqa: F401  (import for the side effect of registration)

    Base.metadata.create_all(bind=engine)


def get_db() -> Iterator[Session]:
    db = SessionLocal()
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def session_scope() -> Session:
    """A session for background work, where FastAPI's dependency does not apply."""
    return SessionLocal()
