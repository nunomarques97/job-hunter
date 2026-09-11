"""Every model, imported here so ``Base.metadata`` is complete.

``init_db`` imports this package. A model that is not re-exported here will not
have a table created for it.
"""
from .activity import ActivityLog
from .application import Application
from .automation import AutomationConfig, AutomationRun
from .candidate import Candidate
from .document import Document
from .email import EmailAccount, EmailMessage, EmailTemplate
from .enums import (
    ACTIVE_STAGES,
    PIPELINE_ORDER,
    RUN_STAGE_ORDER,
    SENIORITY_RANK,
    ApplicationMethod,
    DocumentKind,
    PipelineStage,
    Recommendation,
    RemoteType,
    RunStage,
    RunStatus,
    Seniority,
)
from .job import Job
from .job_score import JobScore

__all__ = [
    "ActivityLog",
    "Application",
    "AutomationConfig",
    "AutomationRun",
    "Candidate",
    "Document",
    "EmailAccount",
    "EmailMessage",
    "EmailTemplate",
    "Job",
    "JobScore",
    "ACTIVE_STAGES",
    "PIPELINE_ORDER",
    "RUN_STAGE_ORDER",
    "SENIORITY_RANK",
    "ApplicationMethod",
    "DocumentKind",
    "PipelineStage",
    "Recommendation",
    "RemoteType",
    "RunStage",
    "RunStatus",
    "Seniority",
]
