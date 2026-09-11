"""Job discovery, search and detail."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import Select, func, or_, select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models.activity import ActivityLog
from ..models.application import Application
from ..models.candidate import Candidate
from ..models.job import Job
from ..models.job_score import JobScore
from ..schemas.common import Message, Page
from ..schemas.job import (
    DiscoveryRequest,
    DiscoveryResponse,
    JobDetail,
    JobSummary,
    SourceOutcomeRead,
)
from ..services.discovery import run_discovery
from ..services.scoring import score_job
from ..sources import available_sources
from .deps import get_candidate

router = APIRouter()

SORT_COLUMNS = {
    "score": JobScore.score,
    "posted": Job.posted_at,
    "discovered": Job.discovered_at,
    "salary": Job.salary_max,
    "company": Job.company,
    "title": Job.title,
}


@router.get("/sources")
async def list_sources() -> list[dict]:
    """Every source, with an honest statement of what it can and cannot do."""
    return available_sources()


@router.post("/discover", response_model=DiscoveryResponse)
async def discover(
    request: DiscoveryRequest,
    db: Session = Depends(get_db),
) -> DiscoveryResponse:
    outcome = await run_discovery(
        db,
        sources=request.sources,
        terms=request.terms,
        locations=request.locations,
        remote_only=request.remote_only,
        greenhouse_boards=request.greenhouse_boards,
        lever_boards=request.lever_boards,
    )
    return DiscoveryResponse(
        created=outcome.created,
        updated=outcome.updated,
        duplicates=outcome.duplicates,
        fetched=outcome.fetched,
        partial=outcome.partial,
        sources=[
            SourceOutcomeRead(
                source=item.source,
                ok=item.ok,
                fetched=item.fetched,
                created=item.created,
                updated=item.updated,
                duplicates=item.duplicates,
                error=item.error,
            )
            for item in outcome.sources
        ],
    )


def _apply_filters(statement: Select, params: dict) -> Select:
    if not params["include_duplicates"]:
        statement = statement.where(Job.duplicate_of_id.is_(None))
    if not params["include_excluded"]:
        statement = statement.where(Job.is_excluded.is_(False))
    if params["saved_only"]:
        statement = statement.where(Job.is_saved.is_(True))

    if params["q"]:
        term = f"%{params['q'].strip()}%"
        statement = statement.where(
            or_(Job.title.ilike(term), Job.company.ilike(term), Job.description.ilike(term))
        )
    if params["sources"]:
        statement = statement.where(Job.source.in_(params["sources"]))
    if params["companies"]:
        statement = statement.where(Job.company.in_(params["companies"]))
    if params["remote_types"]:
        statement = statement.where(Job.remote_type.in_(params["remote_types"]))
    if params["seniorities"]:
        statement = statement.where(Job.seniority.in_(params["seniorities"]))
    if params["locations"]:
        clauses = [Job.location.ilike(f"%{place}%") for place in params["locations"]]
        statement = statement.where(or_(*clauses))
    if params["technologies"]:
        # SQLite has no array containment, so a LIKE against the JSON text is the
        # portable option. Quoting the term keeps "Go" from matching "MongoDB".
        clauses = [Job.technologies.like(f'%"{tech}"%') for tech in params["technologies"]]
        statement = statement.where(or_(*clauses))
    if params["min_salary"]:
        statement = statement.where(
            func.coalesce(Job.salary_max, Job.salary_min, 0) >= params["min_salary"]
        )
    if params["min_score"] is not None:
        statement = statement.where(JobScore.score >= params["min_score"])
    return statement


@router.get("/", response_model=Page[JobSummary])
async def search_jobs(
    q: str = "",
    sources: list[str] = Query(default=[]),
    companies: list[str] = Query(default=[]),
    locations: list[str] = Query(default=[]),
    remote_types: list[str] = Query(default=[]),
    seniorities: list[str] = Query(default=[]),
    technologies: list[str] = Query(default=[]),
    min_score: float | None = None,
    min_salary: int | None = None,
    saved_only: bool = False,
    include_excluded: bool = False,
    include_duplicates: bool = False,
    sort: str = "score",
    direction: str = "desc",
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=1, le=200),
    db: Session = Depends(get_db),
) -> Page[JobSummary]:
    params = {
        "q": q,
        "sources": sources,
        "companies": companies,
        "locations": locations,
        "remote_types": remote_types,
        "seniorities": seniorities,
        "technologies": technologies,
        "min_score": min_score,
        "min_salary": min_salary,
        "saved_only": saved_only,
        "include_excluded": include_excluded,
        "include_duplicates": include_duplicates,
    }

    base = select(Job).outerjoin(JobScore, JobScore.job_id == Job.id)
    base = _apply_filters(base, params)

    count_statement = select(func.count()).select_from(base.subquery())
    total = db.scalar(count_statement) or 0

    column = SORT_COLUMNS.get(sort, JobScore.score)
    ordering = column.desc() if direction == "desc" else column.asc()
    # Unscored jobs must not disappear from a score-sorted list, so nulls sort last.
    statement = base.order_by(ordering.nullslast(), Job.discovered_at.desc())
    statement = statement.offset((page - 1) * page_size).limit(page_size)

    jobs = db.scalars(statement).unique().all()
    return Page[JobSummary](
        items=[JobSummary.model_validate(job) for job in jobs],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get("/facets")
async def job_facets(db: Session = Depends(get_db)) -> dict:
    """Distinct values for the filter controls, with counts."""

    def _counts(column) -> list[dict]:
        rows = db.execute(
            select(column, func.count(Job.id))
            .where(Job.duplicate_of_id.is_(None), Job.is_excluded.is_(False), column != "")
            .group_by(column)
            .order_by(func.count(Job.id).desc())
            .limit(40)
        ).all()
        return [{"value": value, "count": count} for value, count in rows]

    from collections import Counter

    technology_rows = db.scalars(
        select(Job.technologies).where(Job.duplicate_of_id.is_(None), Job.is_excluded.is_(False))
    ).all()
    counter: Counter[str] = Counter()
    for technologies in technology_rows:
        counter.update(technologies or [])

    return {
        "sources": _counts(Job.source),
        "companies": _counts(Job.company),
        "remote_types": _counts(Job.remote_type),
        "seniorities": _counts(Job.seniority),
        "countries": _counts(Job.country),
        "technologies": [
            {"value": name, "count": count} for name, count in counter.most_common(40)
        ],
    }


@router.get("/{job_id}", response_model=JobDetail)
async def get_job(job_id: int, db: Session = Depends(get_db)) -> JobDetail:
    job = db.get(Job, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="That job is not in your database.")

    detail = JobDetail.model_validate(job)
    application = db.scalar(select(Application).where(Application.job_id == job.id))
    detail.has_application = application is not None
    detail.application_id = application.id if application else None
    detail.duplicate_count = (
        db.scalar(select(func.count(Job.id)).where(Job.duplicate_of_id == job.id)) or 0
    )
    return detail


@router.post("/{job_id}/score", response_model=JobDetail)
async def rescore_job(
    job_id: int,
    use_model: bool = True,
    db: Session = Depends(get_db),
    candidate: Candidate = Depends(get_candidate),
) -> JobDetail:
    job = db.get(Job, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="That job is not in your database.")

    result = await score_job(candidate, job, use_model=use_model)
    score = job.score or JobScore(job_id=job.id, candidate_id=candidate.id)
    score.candidate_id = candidate.id
    score.profile_version = candidate.profile_version
    score.score = result.score
    score.confidence = result.confidence
    score.recommendation = result.recommendation
    score.breakdown = result.breakdown
    score.matched_skills = result.matched_skills
    score.missing_skills = result.missing_skills
    score.strengths = result.strengths
    score.gaps = result.gaps
    score.explanation = result.explanation
    score.method = result.method
    db.add(score)
    db.flush()
    db.refresh(job)
    return await get_job(job_id, db)


@router.post("/{job_id}/save", response_model=Message)
async def toggle_saved(job_id: int, saved: bool = True, db: Session = Depends(get_db)) -> Message:
    job = db.get(Job, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="That job is not in your database.")
    job.is_saved = saved
    return Message(message="Saved." if saved else "Removed from saved.")


@router.post("/{job_id}/exclude-company", response_model=Message)
async def exclude_company(
    job_id: int,
    db: Session = Depends(get_db),
    candidate: Candidate = Depends(get_candidate),
) -> Message:
    """Exclude every posting from this company, now and in future runs."""
    job = db.get(Job, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="That job is not in your database.")

    company = job.company.strip()
    excluded = list(candidate.excluded_companies or [])
    if company and company not in excluded:
        excluded.append(company)
        candidate.excluded_companies = excluded

    affected = db.scalars(select(Job).where(Job.company == company)).all()
    for item in affected:
        item.is_excluded = True
        item.exclusion_reason = "Company is on your exclusion list."

    db.add(
        ActivityLog(
            event="job.company_excluded",
            level="info",
            message=f"Excluded {company}. {len(affected)} postings hidden.",
            candidate_id=candidate.id,
            details={"company": company, "affected": len(affected)},
        )
    )
    return Message(message=f"Excluded {company}. {len(affected)} postings hidden.")
