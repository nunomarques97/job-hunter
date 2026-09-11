"""The single declarative base for every model.

Every model in this package must import ``Base`` from here. Declaring a second
base elsewhere silently removes those tables from ``create_all``, which is how
the previous version shipped an empty database file.
"""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import DateTime, Integer
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


def utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


class Base(DeclarativeBase):
    pass


class TimestampedBase(Base):
    """Mixin base carrying a surrogate key and audit timestamps."""

    __abstract__ = True

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=utcnow, onupdate=utcnow, nullable=False
    )
