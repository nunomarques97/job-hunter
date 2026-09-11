"""Automation configuration and run history."""
from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import Boolean, DateTime, Float, Integer, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from ..db.base import TimestampedBase
from .enums import RunStatus


class AutomationConfig(TimestampedBase):
    """Singleton row holding the guard rails for automated runs."""

    __tablename__ = "automation_config"

    enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    #: Nothing is ever submitted while this is true; packages still get prepared.
    dry_run: Mapped[bool] = mapped_column(Boolean, default=True)
    #: Hard stop that overrides every other setting, including a run in flight.
    emergency_stop: Mapped[bool] = mapped_column(Boolean, default=False)

    daily_application_limit: Mapped[int] = mapped_column(Integer, default=25)
    daily_discovery_limit: Mapped[int] = mapped_column(Integer, default=400)
    min_score: Mapped[float] = mapped_column(Float, default=70.0)
    min_score_to_submit: Mapped[float] = mapped_column(Float, default=80.0)

    enabled_sources: Mapped[list[str]] = mapped_column(JSON, default=list)
    greenhouse_boards: Mapped[list[str]] = mapped_column(JSON, default=list)
    lever_boards: Mapped[list[str]] = mapped_column(JSON, default=list)
    search_terms: Mapped[list[str]] = mapped_column(JSON, default=list)

    location_filters: Mapped[list[str]] = mapped_column(JSON, default=list)
    remote_only: Mapped[bool] = mapped_column(Boolean, default=False)
    min_salary: Mapped[int | None] = mapped_column(Integer, nullable=True)
    role_filters: Mapped[list[str]] = mapped_column(JSON, default=list)
    excluded_companies: Mapped[list[str]] = mapped_column(JSON, default=list)

    follow_up_after_days: Mapped[int] = mapped_column(Integer, default=7)
    schedule_cron: Mapped[str] = mapped_column(String(120), default="")

    def blocking_reason(self) -> str | None:
        """Why a run must not start right now, or ``None`` if it may."""
        if self.emergency_stop:
            return "Emergency stop is engaged."
        if not self.enabled:
            return "Automation is disabled."
        return None


class AutomationRun(TimestampedBase):
    __tablename__ = "automation_runs"

    status: Mapped[str] = mapped_column(String(20), default=RunStatus.IDLE, index=True)
    trigger: Mapped[str] = mapped_column(String(30), default="manual")
    dry_run: Mapped[bool] = mapped_column(Boolean, default=True)

    started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    current_stage: Mapped[str] = mapped_column(String(30), default="")
    #: Per-stage state: {stage: {status, started_at, finished_at, count, note}}.
    stages: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)

    jobs_discovered: Mapped[int] = mapped_column(Integer, default=0)
    jobs_deduplicated: Mapped[int] = mapped_column(Integer, default=0)
    jobs_scored: Mapped[int] = mapped_column(Integer, default=0)
    jobs_eligible: Mapped[int] = mapped_column(Integer, default=0)
    packages_prepared: Mapped[int] = mapped_column(Integer, default=0)
    applications_submitted: Mapped[int] = mapped_column(Integer, default=0)
    action_required: Mapped[int] = mapped_column(Integer, default=0)

    errors: Mapped[list[str]] = mapped_column(JSON, default=list)
    config_snapshot: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    summary: Mapped[str] = mapped_column(Text, default="")
