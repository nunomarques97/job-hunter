"""Application pipeline and package preparation."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models.application import Application
from ..models.candidate import Candidate
from ..models.enums import PIPELINE_ORDER, PipelineStage
from ..models.job import Job
from ..schemas.application import (
    ApplicationDetail,
    ApplicationSummary,
    ApplicationUpdate,
    DocumentDetail,
    PreparePackageRequest,
    PreparePackageResponse,
    StageChange,
)
from ..schemas.common import Message, Page
from ..schemas.job import JobSummary
from ..services import applications as application_service
from .deps import get_candidate, require_complete_profile

router = APIRouter()


def _to_summary(db: Session, application: Application) -> ApplicationSummary:
    summary = ApplicationSummary.model_validate(application)
    job = db.get(Job, application.job_id)
    summary.job = JobSummary.model_validate(job) if job is not None else None
    summary.has_cv = application.tailored_cv_id is not None
    summary.has_cover_letter = application.cover_letter_id is not None
    return summary


def _to_detail(db: Session, application: Application) -> ApplicationDetail:
    detail = ApplicationDetail.model_validate(application)
    job = db.get(Job, application.job_id)
    detail.job = JobSummary.model_validate(job) if job is not None else None
    detail.has_cv = application.tailored_cv_id is not None
    detail.has_cover_letter = application.cover_letter_id is not None
    if application.tailored_cv is not None:
        detail.tailored_cv = DocumentDetail.model_validate(application.tailored_cv)
    if application.cover_letter is not None:
        detail.cover_letter = DocumentDetail.model_validate(application.cover_letter)
    return detail


@router.get("/", response_model=Page[ApplicationSummary])
async def list_applications(
    stage: str = "",
    include_archived: bool = False,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=500),
    db: Session = Depends(get_db),
) -> Page[ApplicationSummary]:
    statement = select(Application)
    if not include_archived:
        statement = statement.where(Application.is_archived.is_(False))
    if stage:
        statement = statement.where(Application.stage == stage)

    total = db.scalar(select(func.count()).select_from(statement.subquery())) or 0
    rows = db.scalars(
        statement.order_by(Application.board_position.asc(), Application.updated_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()
    return Page[ApplicationSummary](
        items=[_to_summary(db, row) for row in rows],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get("/board")
async def board(db: Session = Depends(get_db)) -> dict:
    """The Kanban board: every column in order, each with its applications.

    Returned as one payload rather than a request per column, because the board
    must not render half-populated while eleven requests land.
    """
    rows = db.scalars(
        select(Application)
        .where(Application.is_archived.is_(False))
        .order_by(Application.board_position.asc(), Application.updated_at.desc())
    ).all()

    columns: dict[str, list] = {stage: [] for stage in PIPELINE_ORDER}
    for application in rows:
        columns.setdefault(application.stage, []).append(_to_summary(db, application))

    return {
        "columns": [
            {"stage": stage, "count": len(columns.get(stage, [])), "items": columns.get(stage, [])}
            for stage in PIPELINE_ORDER
        ],
        "total": len(rows),
    }


@router.get("/{application_id}", response_model=ApplicationDetail)
async def get_application(application_id: int, db: Session = Depends(get_db)) -> ApplicationDetail:
    application = db.get(Application, application_id)
    if application is None:
        raise HTTPException(status_code=404, detail="That application does not exist.")
    return _to_detail(db, application)


@router.post("/from-job/{job_id}", response_model=ApplicationDetail)
async def create_from_job(
    job_id: int,
    db: Session = Depends(get_db),
    candidate: Candidate = Depends(get_candidate),
) -> ApplicationDetail:
    job = db.get(Job, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="That job is not in your database.")
    application, _ = application_service.get_or_create_application(db, job, candidate)
    return _to_detail(db, application)


@router.post("/{job_id}/prepare", response_model=PreparePackageResponse)
async def prepare(
    job_id: int,
    request: PreparePackageRequest,
    db: Session = Depends(get_db),
    candidate: Candidate = Depends(require_complete_profile),
) -> PreparePackageResponse:
    """Generate the CV and cover letter for one job.

    This can take a while on a local model, which is why the interface shows a
    per-document progress state rather than blocking the whole screen.
    """
    job = db.get(Job, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="That job is not in your database.")

    result = await application_service.prepare_package(
        db, job, candidate, regenerate=request.regenerate
    )
    db.commit()
    db.refresh(result.application)
    return PreparePackageResponse(
        application=_to_detail(db, result.application),
        blocked_reason=result.blocked_reason,
    )


@router.patch("/{application_id}/stage", response_model=ApplicationDetail)
async def change_stage(
    application_id: int,
    change: StageChange,
    db: Session = Depends(get_db),
) -> ApplicationDetail:
    application = db.get(Application, application_id)
    if application is None:
        raise HTTPException(status_code=404, detail="That application does not exist.")
    if change.stage not in PIPELINE_ORDER:
        raise HTTPException(status_code=422, detail=f"Unknown stage {change.stage!r}.")

    if change.stage == PipelineStage.SUBMITTED and application.submitted_at is None:
        application_service.mark_submitted(db, application, note=change.reason)
    else:
        application.record_stage(change.stage, change.reason or "Moved manually.", "user")
        if change.stage in (PipelineStage.INTERVIEW, PipelineStage.OFFER, PipelineStage.REJECTED):
            from ..db.base import utcnow

            application.responded_at = application.responded_at or utcnow()

    if change.board_position is not None:
        application.board_position = change.board_position

    db.flush()
    return _to_detail(db, application)


@router.patch("/{application_id}", response_model=ApplicationDetail)
async def update_application(
    application_id: int,
    update: ApplicationUpdate,
    db: Session = Depends(get_db),
) -> ApplicationDetail:
    application = db.get(Application, application_id)
    if application is None:
        raise HTTPException(status_code=404, detail="That application does not exist.")
    for field, value in update.model_dump(exclude_unset=True).items():
        setattr(application, field, value)
    db.flush()
    return _to_detail(db, application)


@router.delete("/{application_id}", response_model=Message)
async def archive_application(application_id: int, db: Session = Depends(get_db)) -> Message:
    """Archive rather than delete.

    The prepared package is evidence of what was sent, so it is never destroyed
    by a single click.
    """
    application = db.get(Application, application_id)
    if application is None:
        raise HTTPException(status_code=404, detail="That application does not exist.")
    application.is_archived = True
    return Message(message="Archived. It stays in your history and can be restored.")
