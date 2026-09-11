"""Generated and imported documents, with version history.

A document is immutable once superseded: regenerating creates a new row with an
incremented ``version`` pointing at the same ``lineage_key``, so the user can
always go back to what was actually sent.
"""
from __future__ import annotations

from sqlalchemy import Boolean, Float, ForeignKey, Integer, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ..db.base import TimestampedBase
from .enums import DocumentKind


class Document(TimestampedBase):
    __tablename__ = "documents"

    candidate_id: Mapped[int] = mapped_column(
        ForeignKey("candidates.id", ondelete="CASCADE"), index=True
    )
    job_id: Mapped[int | None] = mapped_column(
        ForeignKey("jobs.id", ondelete="CASCADE"), nullable=True, index=True
    )

    kind: Mapped[str] = mapped_column(String(30), default=DocumentKind.TAILORED_CV, index=True)
    title: Mapped[str] = mapped_column(String(300), default="")

    #: Groups every version of the same logical document.
    lineage_key: Mapped[str] = mapped_column(String(120), index=True)
    version: Mapped[int] = mapped_column(Integer, default=1)
    is_current: Mapped[bool] = mapped_column(Boolean, default=True, index=True)

    #: Markdown is the canonical stored form; exports render from it.
    content: Mapped[str] = mapped_column(Text, default="")
    #: Structured form for a CV, so export templates do not re-parse Markdown.
    structured: Mapped[dict] = mapped_column(JSON, default=dict)

    generated_by: Mapped[str] = mapped_column(String(60), default="template")
    model_name: Mapped[str] = mapped_column(String(120), default="")

    #: Outcome of checking the generated text against the candidate's declared
    #: facts. ``passed`` false means the document is held back from submission.
    truthfulness_passed: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    truthfulness_findings: Mapped[list[str]] = mapped_column(JSON, default=list)

    word_count: Mapped[int] = mapped_column(Integer, default=0)
    generation_seconds: Mapped[float] = mapped_column(Float, default=0.0)

    candidate: Mapped["Candidate"] = relationship(back_populates="documents")  # noqa: F821
