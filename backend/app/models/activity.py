"""Append-only activity log.

Every meaningful state change writes one row. This is what the Activity view
reads, and it is the evidence trail behind every number on the dashboard.
"""
from __future__ import annotations

from typing import Any

from sqlalchemy import ForeignKey, Integer, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from ..db.base import TimestampedBase


class ActivityLog(TimestampedBase):
    __tablename__ = "activity_logs"

    #: Dotted event name, for example "job.discovered" or "document.generated".
    event: Mapped[str] = mapped_column(String(80), index=True)
    #: "info", "success", "warning" or "error".
    level: Mapped[str] = mapped_column(String(20), default="info", index=True)
    message: Mapped[str] = mapped_column(Text, default="")

    job_id: Mapped[int | None] = mapped_column(
        ForeignKey("jobs.id", ondelete="SET NULL"), nullable=True, index=True
    )
    application_id: Mapped[int | None] = mapped_column(
        ForeignKey("applications.id", ondelete="SET NULL"), nullable=True, index=True
    )
    candidate_id: Mapped[int | None] = mapped_column(
        ForeignKey("candidates.id", ondelete="SET NULL"), nullable=True, index=True
    )
    run_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)

    details: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
