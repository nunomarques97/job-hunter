"""The candidate profile: the single source of truth for every generated document.

Nothing in this application may state a fact about the candidate that does not
originate here. Generators read this model and are forbidden from inventing
employers, dates, technologies, qualifications, achievements or certifications.
"""
from __future__ import annotations

from typing import Any

from sqlalchemy import Boolean, Integer, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ..db.base import TimestampedBase


class Candidate(TimestampedBase):
    __tablename__ = "candidates"

    # Identity
    full_name: Mapped[str] = mapped_column(String(200), default="", index=True)
    email: Mapped[str] = mapped_column(String(320), default="")
    phone: Mapped[str] = mapped_column(String(64), default="")
    location: Mapped[str] = mapped_column(String(200), default="")
    country: Mapped[str] = mapped_column(String(100), default="")
    headline: Mapped[str] = mapped_column(String(300), default="")
    summary: Mapped[str] = mapped_column(Text, default="")

    linkedin_url: Mapped[str] = mapped_column(String(500), default="")
    github_url: Mapped[str] = mapped_column(String(500), default="")
    website_url: Mapped[str] = mapped_column(String(500), default="")

    years_of_experience: Mapped[float] = mapped_column(default=0.0)
    current_role: Mapped[str] = mapped_column(String(200), default="")

    # Structured history. Each is a list of dicts with a documented shape; the
    # validated form lives in app/schemas/candidate.py.
    experience: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)
    education: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)
    projects: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)
    certifications: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)
    languages: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)

    skills: Mapped[list[str]] = mapped_column(JSON, default=list)
    technologies: Mapped[list[str]] = mapped_column(JSON, default=list)
    achievements: Mapped[list[str]] = mapped_column(JSON, default=list)

    # Targeting
    target_roles: Mapped[list[str]] = mapped_column(JSON, default=list)
    target_locations: Mapped[list[str]] = mapped_column(JSON, default=list)
    target_countries: Mapped[list[str]] = mapped_column(JSON, default=list)
    remote_only: Mapped[bool] = mapped_column(Boolean, default=False)
    accepts_hybrid: Mapped[bool] = mapped_column(Boolean, default=True)
    accepts_onsite: Mapped[bool] = mapped_column(Boolean, default=True)
    willing_to_relocate: Mapped[bool] = mapped_column(Boolean, default=False)
    min_salary: Mapped[int | None] = mapped_column(Integer, nullable=True)
    salary_currency: Mapped[str] = mapped_column(String(8), default="EUR")
    seniority_targets: Mapped[list[str]] = mapped_column(JSON, default=list)

    # Exclusions
    excluded_companies: Mapped[list[str]] = mapped_column(JSON, default=list)
    excluded_keywords: Mapped[list[str]] = mapped_column(JSON, default=list)
    excluded_industries: Mapped[list[str]] = mapped_column(JSON, default=list)

    # Bookkeeping
    profile_version: Mapped[int] = mapped_column(Integer, default=1)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, index=True)

    documents: Mapped[list["Document"]] = relationship(  # noqa: F821
        back_populates="candidate", cascade="all, delete-orphan"
    )

    def fact_inventory(self) -> dict[str, list[str]]:
        """Every verifiable string the candidate has declared.

        Document generation checks its output against this inventory, so a
        fabricated employer or technology is detected rather than shipped.
        """
        employers = [str(item.get("company", "")).strip() for item in self.experience or []]
        titles = [str(item.get("title", "")).strip() for item in self.experience or []]
        institutions = [str(item.get("institution", "")).strip() for item in self.education or []]
        certs = [str(item.get("name", "")).strip() for item in self.certifications or []]
        return {
            "employers": [value for value in employers if value],
            "titles": [value for value in titles if value],
            "institutions": [value for value in institutions if value],
            "certifications": [value for value in certs if value],
            "technologies": list(self.technologies or []),
            "skills": list(self.skills or []),
        }
