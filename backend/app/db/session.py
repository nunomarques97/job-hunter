"""Engine, session factory and schema creation."""
from __future__ import annotations

from collections.abc import Iterator

from sqlalchemy import create_engine, event
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from ..core.config import get_settings
from .base import Base  # noqa: F401  (re-exported through app.db)

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
    """Bring the database up to the schema this code expects.

    This used to be ``Base.metadata.create_all``, which can only add a table
    that is missing: the first changed column would have meant choosing between
    losing an installed database and reading the wrong shape out of it. The
    work is in :mod:`app.db.schema`, including what happens to a database that
    was written before migrations existed here.

    A failure raises :class:`StartupRefusal` and the application does not
    serve. Invariant 4: a half-migrated database is degraded, and every screen
    above it would look complete.
    """
    from .schema import upgrade_to_head

    upgrade_to_head(engine)


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
