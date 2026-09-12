"""Bringing a database up to the schema this code expects.

``create_all`` can only ever add a table that is missing. It cannot add a
column, cannot rename one, and cannot notice that the database in front of it
was written by an older version — so the first time a column changed, the
choice would have been between losing the database and shipping a product that
reads the wrong shape. Alembic replaces it here.

Three cases arrive at :func:`upgrade_to_head`:

* an empty file, or no file at all, which every revision is applied to;
* a database this code has already migrated, which carries an
  ``alembic_version`` row and gets whatever is newer than that row;
* a database written before Alembic existed here, which has the tables but no
  version row. That one is **stamped**, not recreated: it is told it is already
  at the baseline revision, and only later revisions run against it.

The third case is the one with real data behind it, and it is the one where a
wrong guess is unrecoverable. So it is not a guess. The baseline revision
describes the schema as it actually exists in those databases, and before
anything is stamped the tables that are really there are compared against the
tables the baseline says should be — a difference is reported and refused
rather than quietly resolved.
"""
from __future__ import annotations

import logging
from pathlib import Path

from alembic import command
from alembic.config import Config
from alembic.runtime.migration import MigrationContext
from sqlalchemy import create_engine, event, inspect
from sqlalchemy.engine import Engine
from sqlalchemy.pool import NullPool

from ..core.startup import StartupRefusal

logger = logging.getLogger("job_hunter")

#: The revision describing the schema as it stood before Alembic was
#: introduced. A database with tables and no version row is stamped here.
BASELINE_REVISION = "0001_baseline"

#: The table Alembic keeps its own bookkeeping in. Its presence is what
#: separates a database this code has migrated from one it has not.
VERSION_TABLE = "alembic_version"

#: Where the revision scripts live, relative to this file rather than to the
#: repository. Invariant 8: nothing at runtime may assume the checkout layout.
MIGRATIONS_DIR = Path(__file__).resolve().parent / "migrations"


def alembic_config(engine: Engine) -> Config:
    """The configuration the application runs migrations with.

    Built in code rather than read from ``alembic.ini``. A packaged application
    has no repository around it, and a configuration file resolved from the
    working directory is the same defect this task started with.
    """
    config = Config()
    config.set_main_option("script_location", str(MIGRATIONS_DIR))
    config.set_main_option("sqlalchemy.url", engine.url.render_as_string(hide_password=False))
    return config


def migration_engine(url: str) -> Engine:
    """A connection that really does undo a migration that failed.

    SQLite can roll a schema change back. The Python driver is what gets in the
    way: pysqlite opens a transaction implicitly before an INSERT, an UPDATE or
    a DELETE and deliberately *not* before a CREATE or an ALTER, so schema
    changes run outside any transaction and survive the failure of the
    statement after them. A revision that added a column and then failed would
    leave the column behind, on a database recorded as still being at the older
    revision — the half-migrated state requirement 5 exists to prevent.

    So the driver's guessing is switched off and the transaction is opened by
    hand. This is a separate engine from the application's on purpose: the
    setting changes how every statement on a connection is wrapped, and that is
    not a thing to turn on for the whole application as a side effect of having
    migrations.
    """
    engine = create_engine(url, future=True, poolclass=NullPool)
    if engine.url.get_backend_name() != "sqlite":
        return engine

    @event.listens_for(engine, "connect")
    def _stop_the_driver_guessing(dbapi_connection, _record) -> None:
        dbapi_connection.isolation_level = None

    @event.listens_for(engine, "begin")
    def _begin_explicitly(connection) -> None:
        connection.exec_driver_sql("BEGIN")

    return engine


def current_revision(engine: Engine) -> str | None:
    """The revision a database says it is at, or ``None`` if it says nothing."""
    with engine.connect() as connection:
        return MigrationContext.configure(connection).get_current_revision()


def baseline_schema() -> dict[str, set[str]]:
    """The tables and columns the baseline revision creates.

    Built by running the baseline against a throwaway in-memory database and
    looking at the result. That is deliberate rather than lazy: the models are
    the *current* shape and drift away from the baseline the moment a second
    revision exists, so a database being stamped must be compared against the
    revision it is being stamped at and nothing else. Reading the models here
    would have made every pre-Alembic database refuse to open on the day the
    first new column was added.
    """
    from sqlalchemy import create_engine
    from sqlalchemy.pool import StaticPool

    # One connection for the life of the engine: an in-memory SQLite database
    # belongs to its connection, so a second one would find it empty.
    probe = create_engine("sqlite://", future=True, poolclass=StaticPool)
    try:
        config = alembic_config(probe)
        with probe.begin() as connection:
            config.attributes["connection"] = connection
            command.upgrade(config, BASELINE_REVISION)
        inspector = inspect(probe)
        return {
            name: {column["name"] for column in inspector.get_columns(name)}
            for name in inspector.get_table_names()
            if name != VERSION_TABLE
        }
    finally:
        probe.dispose()


def describe_difference(engine: Engine) -> list[str]:
    """How an existing database differs from the baseline, line by line.

    Empty when it does not differ. Anything in here stops the stamp: a database
    that is not at the baseline must not be told that it is, because the stamp
    is the one step that cannot be checked afterwards.
    """
    inspector = inspect(engine)
    present = set(inspector.get_table_names()) - {VERSION_TABLE}
    expected = baseline_schema()

    differences: list[str] = []
    for name in sorted(set(expected) - present):
        differences.append(f"table {name} is missing")
    for name in sorted(present - set(expected)):
        differences.append(f"table {name} is there and the baseline does not describe it")
    for name in sorted(set(expected) & present):
        columns = {column["name"] for column in inspector.get_columns(name)}
        for missing in sorted(expected[name] - columns):
            differences.append(f"{name}.{missing} is missing")
        for extra in sorted(columns - expected[name]):
            differences.append(f"{name}.{extra} is there and the baseline does not describe it")
    return differences


def upgrade_to_head(engine: Engine) -> None:
    """Bring the database this engine points at up to the newest revision.

    Raises :class:`StartupRefusal` rather than returning on failure. A database
    that could not be brought up to date must not be served: invariant 4 says
    degraded is never presented as complete, and a half-migrated database is
    the worst kind of degraded, because every screen above it looks fine.
    """
    config = alembic_config(engine)
    inspector = inspect(engine)
    tables = set(inspector.get_table_names())

    migrator = migration_engine(config.get_main_option("sqlalchemy.url"))
    try:
        if tables and VERSION_TABLE not in tables:
            _stamp_existing(migrator, config, sorted(tables))
        _run_upgrade(migrator, config, engine)
    finally:
        migrator.dispose()


def _run_upgrade(migrator: Engine, config: Config, engine: Engine) -> None:
    """Apply every revision that is newer than the one recorded, or none.

    One transaction covers the whole run, not one per revision. Two revisions
    behind head is an ordinary state for a database that has been sitting on a
    machine for a while, and stopping between them would leave it at a version
    no release ever shipped.
    """
    try:
        with migrator.begin() as connection:
            config.attributes["connection"] = connection
            command.upgrade(config, "head")
    except StartupRefusal:
        raise
    except Exception as failure:  # noqa: BLE001 - every failure here is the same answer
        at = current_revision(engine)
        raise StartupRefusal(
            kind="migration_failed",
            summary=(
                "The database could not be brought up to date, so Job Hunter has not "
                "opened it. Nothing has been half-migrated: the step that failed was "
                "undone, and the database is still at the last version that worked."
            ),
            remedy=(
                "The log below has the error. Job Hunter will try again next time it is "
                "opened; if it keeps failing, the database is in "
                f"{_database_location(engine)} and can be copied out of there."
            ),
            probed=[
                f"the database is at revision {at or 'none recorded'}",
                f"the failure was: {failure}",
            ],
        ) from failure


def _stamp_existing(engine: Engine, config: Config, tables: list[str]) -> None:
    """Tell a pre-Alembic database which revision it is already at.

    Nothing is created and nothing is dropped. The only write is the version
    row, and it is only written once the tables that are there have been
    checked against the ones the baseline describes.
    """
    differences = describe_difference(engine)
    if differences:
        raise StartupRefusal(
            kind="schema_unrecognised",
            summary=(
                "This database has tables Job Hunter did not expect, so it has not been "
                "opened. Recording it at a version it is not actually at would hide the "
                "difference permanently."
            ),
            remedy=(
                "The differences are listed below. Move the database aside to start with "
                f"an empty one: it is in {_database_location(engine)}."
            ),
            probed=differences,
        )

    logger.info(
        "found %d tables and no migration history: stamping the database at %s, "
        "creating nothing and dropping nothing",
        len(tables),
        BASELINE_REVISION,
    )
    with engine.begin() as connection:  # the migration engine, not the application's
        config.attributes["connection"] = connection
        command.stamp(config, BASELINE_REVISION)


def _database_location(engine: Engine) -> str:
    """Where a person would go to find the file, in words they can act on."""
    database = engine.url.database
    if not database or database == ":memory:":
        return "memory"
    return str(Path(database).parent)
