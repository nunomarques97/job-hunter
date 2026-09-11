"""Job and score schemas."""
from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field

from .common import ORMModel


class JobScoreRead(ORMModel):
    id: int
    score: float
    confidence: float
    recommendation: str
    breakdown: dict[str, float] = Field(default_factory=dict)
    matched_skills: list[str] = Field(default_factory=list)
    missing_skills: list[str] = Field(default_factory=list)
    strengths: list[str] = Field(default_factory=list)
    gaps: list[str] = Field(default_factory=list)
    explanation: str = ""
    method: str = "deterministic"


class JobSummary(ORMModel):
    """The shape the job list renders. Deliberately without the description."""

    id: int
    source: str
    title: str
    company: str
    company_logo_url: str = ""
    location: str = ""
    city: str = ""
    country: str = ""
    remote_type: str
    seniority: str
    employment_type: str = ""
    salary_min: float | None = None
    salary_max: float | None = None
    salary_currency: str = ""
    technologies: list[str] = Field(default_factory=list)
    canonical_url: str = ""
    application_url: str = ""
    application_method: str
    posted_at: datetime | None = None
    discovered_at: datetime
    stage: str
    is_saved: bool
    is_excluded: bool
    duplicate_of_id: int | None = None
    score: JobScoreRead | None = None


class JobDetail(JobSummary):
    description: str = ""
    requirements: str = ""
    responsibilities: str = ""
    benefits: list[str] = Field(default_factory=list)
    exclusion_reason: str = ""
    has_application: bool = False
    application_id: int | None = None
    duplicate_count: int = 0


class JobFilters(BaseModel):
    """Everything the Job Search screen can filter by."""

    q: str = ""
    sources: list[str] = Field(default_factory=list)
    companies: list[str] = Field(default_factory=list)
    locations: list[str] = Field(default_factory=list)
    remote_types: list[str] = Field(default_factory=list)
    seniorities: list[str] = Field(default_factory=list)
    technologies: list[str] = Field(default_factory=list)
    min_score: float | None = None
    min_salary: int | None = None
    saved_only: bool = False
    include_excluded: bool = False
    include_duplicates: bool = False
    sort: str = "score"
    direction: str = "desc"


class DiscoveryRequest(BaseModel):
    sources: list[str] = Field(default_factory=list)
    terms: list[str] = Field(default_factory=list)
    locations: list[str] = Field(default_factory=list)
    remote_only: bool = False
    greenhouse_boards: list[str] = Field(default_factory=list)
    lever_boards: list[str] = Field(default_factory=list)


class SourceOutcomeRead(BaseModel):
    source: str
    ok: bool
    fetched: int = 0
    created: int = 0
    updated: int = 0
    duplicates: int = 0
    error: str = ""


class DiscoveryResponse(BaseModel):
    created: int
    updated: int
    duplicates: int
    fetched: int
    partial: bool
    sources: list[SourceOutcomeRead]
