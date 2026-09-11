"""An application: one job, one candidate, one prepared package, one pipeline position."""
from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ..db.base import TimestampedBase, utcnow
from .enums import ApplicationMethod, PipelineStage


class Application(TimestampedBase):
    __tablename__ = "applications"

    job_id: Mapped[int] = mapped_column(
        ForeignKey("jobs.id", ondelete="CASCADE"), index=True, unique=True
    )
    candidate_id: Mapped[int] = mapped_column(
        ForeignKey("candidates.id", ondelete="CASCADE"), index=True
    )

    stage: Mapped[str] = mapped_column(String(30), default=PipelineStage.DISCOVERED, index=True)
    #: Ordering within a Kanban column, so a manual reorder survives a reload.
    board_position: Mapped[int] = mapped_column(Integer, default=0)

    application_method: Mapped[str] = mapped_column(String(30), default=ApplicationMethod.MANUAL)
    application_url: Mapped[str] = mapped_column(String(1000), default="")

    #: Set whenever the application cannot proceed without a person. The prepared
    #: package is always retained so the user can finish it by hand.
    action_required_reason: Mapped[str] = mapped_column(String(500), default="")

    submitted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    responded_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    interview_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    follow_up_due: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    follow_up_count: Mapped[int] = mapped_column(Integer, default=0)
    is_archived: Mapped[bool] = mapped_column(Boolean, default=False, index=True)

    # The application package.
    job_snapshot: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    tailored_cv_id: Mapped[int | None] = mapped_column(
        ForeignKey("documents.id", ondelete="SET NULL"), nullable=True
    )
    cover_letter_id: Mapped[int | None] = mapped_column(
        ForeignKey("documents.id", ondelete="SET NULL"), nullable=True
    )
    application_answers: Mapped[list[dict[str, str]]] = mapped_column(JSON, default=list)
    recruiter_message: Mapped[str] = mapped_column(Text, default="")
    notes: Mapped[str] = mapped_column(Text, default="")

    #: Append-only audit of every stage change: {stage, at, reason, actor}.
    stage_history: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)

    job: Mapped["Job"] = relationship(back_populates="application")  # noqa: F821
    tailored_cv: Mapped["Document | None"] = relationship(  # noqa: F821
        foreign_keys=[tailored_cv_id]
    )
    cover_letter: Mapped["Document | None"] = relationship(  # noqa: F821
        foreign_keys=[cover_letter_id]
    )

    def record_stage(self, stage: str, reason: str = "", actor: str = "system") -> None:
        """Move to ``stage`` and append to the audit trail."""
        self.stage = stage
        history = list(self.stage_history or [])
        history.append(
            {
                "stage": stage,
                "at": utcnow().isoformat(),
                "reason": reason,
                "actor": actor,
            }
        )
        self.stage_history = history

    @property
    def package_is_complete(self) -> bool:
        return self.tailored_cv_id is not None and self.cover_letter_id is not None
