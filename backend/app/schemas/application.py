"""Application, document and automation schemas."""
from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field

from .common import ORMModel
from .job import JobSummary


class DocumentSummary(ORMModel):
    id: int
    kind: str
    title: str
    version: int
    is_current: bool
    generated_by: str
    model_name: str = ""
    truthfulness_passed: bool
    truthfulness_findings: list[str] = Field(default_factory=list)
    word_count: int
    generation_seconds: float
    created_at: datetime


class DocumentDetail(DocumentSummary):
    content: str = ""
    job_id: int | None = None


class ApplicationSummary(ORMModel):
    id: int
    job_id: int
    stage: str
    board_position: int
    application_method: str
    application_url: str = ""
    action_required_reason: str = ""
    submitted_at: datetime | None = None
    responded_at: datetime | None = None
    interview_at: datetime | None = None
    follow_up_due: datetime | None = None
    follow_up_count: int
    is_archived: bool
    created_at: datetime
    updated_at: datetime
    job: JobSummary | None = None
    has_cv: bool = False
    has_cover_letter: bool = False


class ApplicationDetail(ApplicationSummary):
    job_snapshot: dict[str, Any] = Field(default_factory=dict)
    application_answers: list[dict[str, str]] = Field(default_factory=list)
    recruiter_message: str = ""
    notes: str = ""
    stage_history: list[dict[str, Any]] = Field(default_factory=list)
    tailored_cv: DocumentDetail | None = None
    cover_letter: DocumentDetail | None = None


class StageChange(BaseModel):
    stage: str
    reason: str = ""
    board_position: int | None = None


class ApplicationUpdate(BaseModel):
    notes: str | None = None
    recruiter_message: str | None = None
    application_answers: list[dict[str, str]] | None = None
    interview_at: datetime | None = None
    is_archived: bool | None = None


class PreparePackageRequest(BaseModel):
    regenerate: bool = False


class PreparePackageResponse(BaseModel):
    application: ApplicationDetail
    blocked_reason: str = ""


class AutomationConfigRead(ORMModel):
    id: int
    enabled: bool
    dry_run: bool
    emergency_stop: bool
    daily_application_limit: int
    daily_discovery_limit: int
    min_score: float
    min_score_to_submit: float
    enabled_sources: list[str] = Field(default_factory=list)
    greenhouse_boards: list[str] = Field(default_factory=list)
    lever_boards: list[str] = Field(default_factory=list)
    search_terms: list[str] = Field(default_factory=list)
    location_filters: list[str] = Field(default_factory=list)
    remote_only: bool
    min_salary: int | None = None
    role_filters: list[str] = Field(default_factory=list)
    excluded_companies: list[str] = Field(default_factory=list)
    follow_up_after_days: int
    schedule_cron: str = ""


class AutomationConfigUpdate(BaseModel):
    enabled: bool | None = None
    dry_run: bool | None = None
    emergency_stop: bool | None = None
    daily_application_limit: int | None = None
    daily_discovery_limit: int | None = None
    min_score: float | None = None
    min_score_to_submit: float | None = None
    enabled_sources: list[str] | None = None
    greenhouse_boards: list[str] | None = None
    lever_boards: list[str] | None = None
    search_terms: list[str] | None = None
    location_filters: list[str] | None = None
    remote_only: bool | None = None
    min_salary: int | None = None
    role_filters: list[str] | None = None
    excluded_companies: list[str] | None = None
    follow_up_after_days: int | None = None
    schedule_cron: str | None = None


class AutomationRunRead(ORMModel):
    id: int
    status: str
    trigger: str
    dry_run: bool
    started_at: datetime | None = None
    finished_at: datetime | None = None
    current_stage: str = ""
    stages: dict[str, Any] = Field(default_factory=dict)
    jobs_discovered: int
    jobs_deduplicated: int
    jobs_scored: int
    jobs_eligible: int
    packages_prepared: int
    applications_submitted: int
    action_required: int
    errors: list[str] = Field(default_factory=list)
    summary: str = ""


class AutomationState(BaseModel):
    is_running: bool
    is_paused: bool
    current_run: AutomationRunRead | None = None
    config: AutomationConfigRead
    blocking_reason: str | None = None


class ActivityRead(ORMModel):
    id: int
    event: str
    level: str
    message: str
    job_id: int | None = None
    application_id: int | None = None
    run_id: int | None = None
    details: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime
