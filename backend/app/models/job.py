"""A normalised job posting.

Job text arrives from third-party sources and is treated as untrusted input: it
is stored, displayed and passed to the model as data, never interpreted as
instructions and never used to build a command.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import Boolean, DateTime, Float, Index, Integer, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ..db.base import TimestampedBase, utcnow
from .enums import ApplicationMethod, PipelineStage, RemoteType, Seniority


class Job(TimestampedBase):
    __tablename__ = "jobs"

    source: Mapped[str] = mapped_column(String(50), index=True)
    source_job_id: Mapped[str] = mapped_column(String(200), index=True)
    canonical_url: Mapped[str] = mapped_column(String(1000), default="")
    application_url: Mapped[str] = mapped_column(String(1000), default="")
    application_method: Mapped[str] = mapped_column(String(30), default=ApplicationMethod.MANUAL)

    title: Mapped[str] = mapped_column(String(300), index=True)
    company: Mapped[str] = mapped_column(String(200), index=True)
    company_domain: Mapped[str] = mapped_column(String(200), default="")
    company_logo_url: Mapped[str] = mapped_column(String(1000), default="")

    location: Mapped[str] = mapped_column(String(300), default="")
    city: Mapped[str] = mapped_column(String(120), default="")
    country: Mapped[str] = mapped_column(String(120), default="", index=True)
    remote_type: Mapped[str] = mapped_column(String(20), default=RemoteType.UNKNOWN, index=True)

    employment_type: Mapped[str] = mapped_column(String(40), default="")
    seniority: Mapped[str] = mapped_column(String(20), default=Seniority.UNKNOWN, index=True)

    salary_min: Mapped[float | None] = mapped_column(Float, nullable=True)
    salary_max: Mapped[float | None] = mapped_column(Float, nullable=True)
    salary_currency: Mapped[str] = mapped_column(String(8), default="")
    salary_period: Mapped[str] = mapped_column(String(16), default="year")

    description: Mapped[str] = mapped_column(Text, default="")
    requirements: Mapped[str] = mapped_column(Text, default="")
    responsibilities: Mapped[str] = mapped_column(Text, default="")
    technologies: Mapped[list[str]] = mapped_column(JSON, default=list)
    benefits: Mapped[list[str]] = mapped_column(JSON, default=list)

    posted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    discovered_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)
    #: The last time a source still listed this posting.
    #:
    #: Nullable, and null on every row that was stored before this column
    #: existed. That is the honest answer for them: nothing ever checked, so
    #: nothing can be said about when the posting was last seen. A row that has
    #: never been re-discovered is not the same as a row known to be gone.
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    deadline: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    #: Stable identity across sources, used for deduplication.
    content_hash: Mapped[str] = mapped_column(String(64), index=True)
    duplicate_of_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)

    stage: Mapped[str] = mapped_column(String(30), default=PipelineStage.DISCOVERED, index=True)
    is_saved: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    is_excluded: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    exclusion_reason: Mapped[str] = mapped_column(String(300), default="")

    raw_payload: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)

    score: Mapped["JobScore | None"] = relationship(  # noqa: F821
        back_populates="job", uselist=False, cascade="all, delete-orphan"
    )
    application: Mapped["Application | None"] = relationship(  # noqa: F821
        back_populates="job", uselist=False, cascade="all, delete-orphan"
    )

    __table_args__ = (
        Index("ix_jobs_source_identity", "source", "source_job_id", unique=True),
        Index("ix_jobs_company_title", "company", "title"),
    )

    @property
    def is_duplicate(self) -> bool:
        return self.duplicate_of_id is not None
