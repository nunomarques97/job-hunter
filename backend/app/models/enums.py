"""Shared vocabularies.

These are plain string enums so they serialise straight to JSON and remain
readable in the SQLite file, which matters when the user inspects their own data.
"""
from __future__ import annotations

from enum import StrEnum


class PipelineStage(StrEnum):
    DISCOVERED = "discovered"
    ELIGIBLE = "eligible"
    READY = "ready"
    PREPARED = "prepared"
    SUBMITTED = "submitted"
    FOLLOW_UP = "follow_up"
    INTERVIEW = "interview"
    OFFER = "offer"
    REJECTED = "rejected"
    CLOSED = "closed"
    ACTION_REQUIRED = "action_required"


#: The order the Kanban board renders columns in.
PIPELINE_ORDER: list[str] = [stage.value for stage in PipelineStage]

#: Stages that represent an application that left our hands.
ACTIVE_STAGES = {
    PipelineStage.SUBMITTED,
    PipelineStage.FOLLOW_UP,
    PipelineStage.INTERVIEW,
    PipelineStage.OFFER,
}


class RemoteType(StrEnum):
    REMOTE = "remote"
    HYBRID = "hybrid"
    ONSITE = "onsite"
    UNKNOWN = "unknown"


class Seniority(StrEnum):
    INTERN = "intern"
    JUNIOR = "junior"
    MID = "mid"
    SENIOR = "senior"
    LEAD = "lead"
    PRINCIPAL = "principal"
    EXECUTIVE = "executive"
    UNKNOWN = "unknown"


SENIORITY_RANK = {
    Seniority.INTERN: 0,
    Seniority.JUNIOR: 1,
    Seniority.MID: 2,
    Seniority.SENIOR: 3,
    Seniority.LEAD: 4,
    Seniority.PRINCIPAL: 5,
    Seniority.EXECUTIVE: 6,
}


class Recommendation(StrEnum):
    STRONG_APPLY = "strong_apply"
    APPLY = "apply"
    MAYBE = "maybe"
    SKIP = "skip"


class ApplicationMethod(StrEnum):
    """How an application can legitimately be delivered for a given posting.

    ``MANUAL`` is not a failure state. It is the honest answer whenever a source
    offers no documented, authorised submission mechanism, and it routes the
    prepared package to ACTION_REQUIRED rather than attempting anything the site
    has not sanctioned.
    """

    EMAIL = "email"
    API = "api"
    EXTERNAL_FORM = "external_form"
    MANUAL = "manual"


class DocumentKind(StrEnum):
    MASTER_CV = "master_cv"
    TAILORED_CV = "tailored_cv"
    COVER_LETTER = "cover_letter"


class RunStatus(StrEnum):
    IDLE = "idle"
    RUNNING = "running"
    PAUSED = "paused"
    COMPLETED = "completed"
    FAILED = "failed"
    STOPPED = "stopped"


class RunStage(StrEnum):
    DISCOVER = "discover"
    NORMALIZE = "normalize"
    DEDUPLICATE = "deduplicate"
    SCORE = "score"
    FILTER = "filter"
    PREPARE = "prepare"
    SUBMIT = "submit"
    TRACK = "track"
    FOLLOW_UP = "follow_up"
    ANALYZE = "analyze"


RUN_STAGE_ORDER: list[str] = [stage.value for stage in RunStage]
