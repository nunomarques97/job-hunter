"""Analytics and the dashboard payload."""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models.activity import ActivityLog
from ..models.application import Application
from ..models.automation import AutomationRun
from ..models.candidate import Candidate
from ..models.job import Job
from ..models.job_score import JobScore
from ..schemas.application import ActivityRead, AutomationRunRead
from ..schemas.job import JobSummary
from ..services import analytics as analytics_service
from ..services.automation import engine, get_config
from .deps import completeness, get_candidate

router = APIRouter()


@router.get("/overview")
async def overview(db: Session = Depends(get_db)) -> dict:
    return analytics_service.overview(db)


@router.get("/pipeline")
async def pipeline(db: Session = Depends(get_db)) -> list[dict]:
    return analytics_service.pipeline_counts(db)


@router.get("/daily")
async def daily(days: int = Query(default=30, ge=7, le=180), db: Session = Depends(get_db)) -> list[dict]:
    return analytics_service.daily_series(db, days=days)


@router.get("/sources")
async def sources(db: Session = Depends(get_db)) -> list[dict]:
    return analytics_service.source_performance(db)


@router.get("/funnel")
async def funnel(db: Session = Depends(get_db)) -> list[dict]:
    return analytics_service.funnel(db)


@router.get("/geography")
async def geography(db: Session = Depends(get_db)) -> list[dict]:
    return analytics_service.geography(db)


@router.get("/salary")
async def salary(db: Session = Depends(get_db)) -> dict:
    return analytics_service.salary_distribution(db)


@router.get("/technologies")
async def technologies(db: Session = Depends(get_db)) -> list[dict]:
    return analytics_service.top_technologies(db)


@router.get("/dashboard")
async def dashboard(
    db: Session = Depends(get_db),
    candidate: Candidate = Depends(get_candidate),
) -> dict:
    """Everything the dashboard renders, in one request.

    The dashboard shows eight panels. Eight separate requests would make it
    appear in eight stages, which reads as slow even when it is not.
    """
    recent_rows = db.execute(
        select(Job, JobScore)
        .join(JobScore, JobScore.job_id == Job.id)
        .where(Job.duplicate_of_id.is_(None), Job.is_excluded.is_(False))
        .order_by(JobScore.score.desc(), Job.discovered_at.desc())
        .limit(6)
    ).all()

    last_run = db.scalar(
        select(AutomationRun).order_by(AutomationRun.created_at.desc()).limit(1)
    )
    activity = db.scalars(
        select(ActivityLog).order_by(ActivityLog.created_at.desc()).limit(8)
    ).all()
    config = get_config(db)

    return {
        "candidate": {
            "full_name": candidate.full_name,
            "headline": candidate.headline,
            "completeness": completeness(candidate),
        },
        "overview": analytics_service.overview(db),
        "pipeline": analytics_service.pipeline_counts(db),
        "daily": analytics_service.daily_series(db, days=30),
        "recent_matches": [JobSummary.model_validate(job) for job, _ in recent_rows],
        "automation": {
            "is_running": engine.is_running,
            "is_paused": engine.is_paused,
            "enabled": config.enabled,
            "dry_run": config.dry_run,
            "emergency_stop": config.emergency_stop,
            "last_run": AutomationRunRead.model_validate(last_run) if last_run else None,
        },
        "activity": [ActivityRead.model_validate(row) for row in activity],
        "insights": _insights(db, candidate),
    }


def _insights(db: Session, candidate: Candidate) -> list[dict]:
    """Observations derived from the user's own rows.

    Every insight here is arithmetic on data the user can go and check. Nothing
    is generated, and nothing is claimed that a query did not produce.
    """
    insights: list[dict] = []
    stats = analytics_service.overview(db)

    profile = completeness(candidate)
    if not profile["ready_for_generation"]:
        insights.append(
            {
                "level": "warning",
                "title": "Your profile is incomplete",
                "body": (
                    "Document generation is off until these are filled in: "
                    + ", ".join(profile["missing"][:3])
                    + "."
                ),
                "action": {"label": "Open Profile", "view": "profile"},
            }
        )

    technologies = analytics_service.top_technologies(db, limit=8)
    owned = {item.lower() for item in [*(candidate.technologies or []), *(candidate.skills or [])]}
    gaps = [item for item in technologies if item["technology"].lower() not in owned]
    if gaps and stats["jobs_discovered"] > 20:
        top = gaps[0]
        insights.append(
            {
                "level": "info",
                "title": f"{top['technology']} appears in {top['count']} of your postings",
                "body": (
                    f"It is not on your profile. If you have used it, adding it would change "
                    f"the score on those {top['count']} postings."
                ),
                "action": {"label": "Open Profile", "view": "profile"},
            }
        )

    performance = analytics_service.source_performance(db)
    if len(performance) > 1:
        best = max(performance, key=lambda item: item["average_score"])
        if best["jobs"] >= 5:
            insights.append(
                {
                    "level": "success",
                    "title": f"{best['source'].replace('_', ' ').title()} produces your best matches",
                    "body": (
                        f"{best['jobs']} postings at an average score of {best['average_score']}. "
                        "Widening this source would raise the quality of your queue."
                    ),
                    "action": {"label": "Open Settings", "view": "settings"},
                }
            )

    if stats["applications_submitted"] >= 5:
        response = stats["response_rate"]
        insights.append(
            {
                "level": "info" if response["value"] >= 10 else "warning",
                "title": f"Response rate {response['value']}%",
                "body": (
                    f"{response['numerator']} replies from {response['denominator']} submitted "
                    "applications."
                    + (" Too few to draw a conclusion yet." if response["low_confidence"] else "")
                ),
                "action": {"label": "Open Analytics", "view": "analytics"},
            }
        )

    return insights[:4]


@router.get("/activity")
async def activity(
    level: str = "",
    event: str = "",
    limit: int = Query(default=100, ge=1, le=500),
    db: Session = Depends(get_db),
) -> list[ActivityRead]:
    statement = select(ActivityLog)
    if level:
        statement = statement.where(ActivityLog.level == level)
    if event:
        statement = statement.where(ActivityLog.event.like(f"{event}%"))
    rows = db.scalars(statement.order_by(ActivityLog.created_at.desc()).limit(limit)).all()
    return [ActivityRead.model_validate(row) for row in rows]
