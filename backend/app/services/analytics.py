"""Analytics.

Every figure here is computed from rows the user can inspect. Rates are returned
with their numerator and denominator so the interface can show "3 of 48" rather
than a bare percentage, and a rate over a denominator below five is marked
``low_confidence`` rather than presented as if it meant something.
"""
from __future__ import annotations

from collections import Counter
from datetime import timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..db.base import utcnow
from ..models.application import Application
from ..models.enums import PipelineStage
from ..models.job import Job
from ..models.job_score import JobScore

MIN_DENOMINATOR_FOR_CONFIDENCE = 5


def _rate(numerator: int, denominator: int) -> dict:
    return {
        "numerator": numerator,
        "denominator": denominator,
        "value": round(numerator / denominator * 100, 1) if denominator else 0.0,
        "low_confidence": denominator < MIN_DENOMINATOR_FOR_CONFIDENCE,
    }


def overview(db: Session) -> dict:
    """The dashboard headline figures."""
    jobs_total = db.scalar(select(func.count(Job.id)).where(Job.duplicate_of_id.is_(None))) or 0
    strong = (
        db.scalar(
            select(func.count(JobScore.id)).join(Job, Job.id == JobScore.job_id).where(
                JobScore.score >= 85, Job.duplicate_of_id.is_(None)
            )
        )
        or 0
    )
    prepared = db.scalar(
        select(func.count(Application.id)).where(
            Application.stage.in_(
                [PipelineStage.PREPARED, PipelineStage.READY, PipelineStage.ACTION_REQUIRED]
            )
        )
    ) or 0
    submitted = db.scalar(
        select(func.count(Application.id)).where(Application.submitted_at.is_not(None))
    ) or 0
    interviews = db.scalar(
        select(func.count(Application.id)).where(Application.stage == PipelineStage.INTERVIEW)
    ) or 0
    offers = db.scalar(
        select(func.count(Application.id)).where(Application.stage == PipelineStage.OFFER)
    ) or 0
    responded = db.scalar(
        select(func.count(Application.id)).where(Application.responded_at.is_not(None))
    ) or 0

    week_ago = utcnow() - timedelta(days=7)
    jobs_this_week = (
        db.scalar(
            select(func.count(Job.id)).where(
                Job.discovered_at >= week_ago, Job.duplicate_of_id.is_(None)
            )
        )
        or 0
    )
    submitted_this_week = (
        db.scalar(
            select(func.count(Application.id)).where(Application.submitted_at >= week_ago)
        )
        or 0
    )

    average = db.scalar(
        select(func.avg(JobScore.score)).join(Job, Job.id == JobScore.job_id).where(
            Job.duplicate_of_id.is_(None)
        )
    )

    return {
        "jobs_discovered": jobs_total,
        "jobs_discovered_this_week": jobs_this_week,
        "strong_matches": strong,
        "applications_prepared": prepared,
        "applications_submitted": submitted,
        "applications_submitted_this_week": submitted_this_week,
        "interviews": interviews,
        "offers": offers,
        "average_score": round(float(average), 1) if average is not None else 0.0,
        "response_rate": _rate(responded, submitted),
        "interview_rate": _rate(interviews, submitted),
        "offer_rate": _rate(offers, submitted),
    }


def pipeline_counts(db: Session) -> list[dict]:
    """One entry per Kanban column, in board order."""
    from ..models.enums import PIPELINE_ORDER

    rows = db.execute(
        select(Application.stage, func.count(Application.id))
        .where(Application.is_archived.is_(False))
        .group_by(Application.stage)
    ).all()
    counts = {stage: count for stage, count in rows}
    return [{"stage": stage, "count": counts.get(stage, 0)} for stage in PIPELINE_ORDER]


def daily_series(db: Session, days: int = 30) -> list[dict]:
    """Jobs discovered and applications submitted per day.

    Days with no activity are present with zeroes, because a chart with gaps in
    the x axis misleads about the trend.
    """
    start = (utcnow() - timedelta(days=days - 1)).replace(hour=0, minute=0, second=0, microsecond=0)

    job_rows = db.execute(
        select(func.date(Job.discovered_at), func.count(Job.id))
        .where(Job.discovered_at >= start, Job.duplicate_of_id.is_(None))
        .group_by(func.date(Job.discovered_at))
    ).all()
    application_rows = db.execute(
        select(func.date(Application.submitted_at), func.count(Application.id))
        .where(Application.submitted_at >= start)
        .group_by(func.date(Application.submitted_at))
    ).all()

    jobs_by_day = {str(day): count for day, count in job_rows if day}
    applications_by_day = {str(day): count for day, count in application_rows if day}

    series = []
    for offset in range(days):
        day = (start + timedelta(days=offset)).date().isoformat()
        series.append(
            {
                "date": day,
                "jobs": jobs_by_day.get(day, 0),
                "applications": applications_by_day.get(day, 0),
            }
        )
    return series


def source_performance(db: Session) -> list[dict]:
    """Which sources actually produce applications, not just volume."""
    rows = db.execute(
        select(
            Job.source,
            func.count(Job.id),
            func.avg(JobScore.score),
            func.count(Application.id),
            func.count(Application.submitted_at),
        )
        .outerjoin(JobScore, JobScore.job_id == Job.id)
        .outerjoin(Application, Application.job_id == Job.id)
        .where(Job.duplicate_of_id.is_(None))
        .group_by(Job.source)
    ).all()

    return sorted(
        [
            {
                "source": source,
                "jobs": jobs,
                "average_score": round(float(average), 1) if average is not None else None,
                "applications": applications,
                "submitted": submitted,
            }
            for source, jobs, average, applications, submitted in rows
        ],
        key=lambda item: item["jobs"],
        reverse=True,
    )


def funnel(db: Session) -> list[dict]:
    """Absolute counts at each narrowing of the pipeline."""
    discovered = db.scalar(select(func.count(Job.id)).where(Job.duplicate_of_id.is_(None))) or 0
    scored = db.scalar(select(func.count(JobScore.id))) or 0
    eligible = db.scalar(select(func.count(JobScore.id)).where(JobScore.score >= 70)) or 0
    prepared = db.scalar(select(func.count(Application.id))) or 0
    submitted = (
        db.scalar(select(func.count(Application.id)).where(Application.submitted_at.is_not(None))) or 0
    )
    interviews = (
        db.scalar(
            select(func.count(Application.id)).where(Application.stage == PipelineStage.INTERVIEW)
        )
        or 0
    )
    offers = (
        db.scalar(select(func.count(Application.id)).where(Application.stage == PipelineStage.OFFER))
        or 0
    )

    stages = [
        ("Discovered", discovered),
        ("Scored", scored),
        ("Eligible", eligible),
        ("Prepared", prepared),
        ("Submitted", submitted),
        ("Interview", interviews),
        ("Offer", offers),
    ]
    top = discovered or 1
    return [
        {"stage": name, "count": count, "share": round(count / top * 100, 1)}
        for name, count in stages
    ]


def geography(db: Session, limit: int = 12) -> list[dict]:
    rows = db.execute(
        select(Job.country, func.count(Job.id))
        .where(Job.duplicate_of_id.is_(None), Job.country != "")
        .group_by(Job.country)
        .order_by(func.count(Job.id).desc())
        .limit(limit)
    ).all()
    return [{"country": country, "count": count} for country, count in rows]


def salary_distribution(db: Session) -> dict:
    """Salary spread across postings that actually advertise one."""
    values = db.scalars(
        select(Job.salary_max).where(
            Job.duplicate_of_id.is_(None), Job.salary_max.is_not(None), Job.salary_max > 0
        )
    ).all()
    numbers = sorted(float(value) for value in values)
    if not numbers:
        return {"count": 0, "median": 0, "p25": 0, "p75": 0, "min": 0, "max": 0}

    def _percentile(fraction: float) -> float:
        index = min(len(numbers) - 1, int(len(numbers) * fraction))
        return round(numbers[index], 0)

    return {
        "count": len(numbers),
        "min": round(numbers[0], 0),
        "p25": _percentile(0.25),
        "median": _percentile(0.5),
        "p75": _percentile(0.75),
        "max": round(numbers[-1], 0),
    }


def top_technologies(db: Session, limit: int = 15) -> list[dict]:
    """Most-demanded technologies across discovered postings."""
    rows = db.scalars(
        select(Job.technologies).where(Job.duplicate_of_id.is_(None), Job.technologies.is_not(None))
    ).all()
    counter: Counter[str] = Counter()
    for technologies in rows:
        counter.update(technologies or [])
    return [{"technology": name, "count": count} for name, count in counter.most_common(limit)]
