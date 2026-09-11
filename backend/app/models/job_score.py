"""The result of matching one job against one version of the candidate profile."""
from __future__ import annotations

from sqlalchemy import Float, ForeignKey, Integer, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ..db.base import TimestampedBase
from .enums import Recommendation


class JobScore(TimestampedBase):
    __tablename__ = "job_scores"

    job_id: Mapped[int] = mapped_column(
        ForeignKey("jobs.id", ondelete="CASCADE"), index=True, unique=True
    )
    candidate_id: Mapped[int] = mapped_column(
        ForeignKey("candidates.id", ondelete="CASCADE"), index=True
    )
    profile_version: Mapped[int] = mapped_column(Integer, default=1)

    score: Mapped[float] = mapped_column(Float, default=0.0, index=True)
    confidence: Mapped[float] = mapped_column(Float, default=0.0)
    recommendation: Mapped[str] = mapped_column(String(20), default=Recommendation.MAYBE, index=True)

    #: Per-dimension contributions, so the interface can explain the number
    #: instead of asking the user to trust it.
    breakdown: Mapped[dict[str, float]] = mapped_column(JSON, default=dict)

    matched_skills: Mapped[list[str]] = mapped_column(JSON, default=list)
    missing_skills: Mapped[list[str]] = mapped_column(JSON, default=list)
    strengths: Mapped[list[str]] = mapped_column(JSON, default=list)
    gaps: Mapped[list[str]] = mapped_column(JSON, default=list)
    explanation: Mapped[str] = mapped_column(Text, default="")

    #: "deterministic" when the model was unavailable, "hybrid" when the model
    #: refined a deterministic base. The interface shows this, so a degraded
    #: result is never presented as a complete one.
    method: Mapped[str] = mapped_column(String(20), default="deterministic")

    job: Mapped["Job"] = relationship(back_populates="score")  # noqa: F821
