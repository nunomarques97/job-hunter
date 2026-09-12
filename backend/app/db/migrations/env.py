"""The environment Alembic runs a migration in.

Two callers reach this file. The application calls it through
:func:`app.db.schema.upgrade_to_head`, which hands over the engine it already
built so the migration runs on the same connection, with the same pragmas, as
everything else. A developer calls it through the ``alembic`` command line to
write a new revision, and then there is no engine yet and one is built from
``alembic.ini``.

Every model stays on the single ``Base`` in ``app/db/base.py``. Importing the
models package here is what puts them on it: a model that is not imported is
invisible to autogenerate, and a revision that cannot see a table will happily
propose dropping it.
"""
from __future__ import annotations

from logging.config import fileConfig

from alembic import context
from sqlalchemy import engine_from_config, pool

from app.db.base import Base
from app import models  # noqa: F401  (imported for the side effect of registration)

config = context.config

# Only the command line has a file to configure logging from. The application
# builds this configuration in code and has already set its own logging up;
# re-reading a file here would replace it.
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    """Emit SQL to a script rather than to a database."""
    context.configure(
        url=config.get_main_option("sqlalchemy.url"),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        render_as_batch=True,
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Run against a live connection.

    ``render_as_batch`` is on because the database is SQLite, which cannot drop
    or alter a column in place: Alembic rebuilds the table instead. Without it
    every later revision that touches an existing column would fail on the one
    database this product actually runs on.
    """
    connection = config.attributes.get("connection")
    if connection is not None:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            render_as_batch=True,
        )
        with context.begin_transaction():
            context.run_migrations()
        return

    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as new_connection:
        context.configure(
            connection=new_connection,
            target_metadata=target_metadata,
            render_as_batch=True,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
