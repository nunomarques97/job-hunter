"""Discovery: fetch, normalise, deduplicate and persist.

This is the boundary where third-party data becomes a row in the user's
database. Everything crossing it is normalised and deduplicated first, and the
outcome is reported honestly, including which sources failed.
"""
from __future__ import annotations

from dataclasses import dataclass, field

from sqlalchemy.orm import Session

from ..core.config import get_settings
from ..db.base import utcnow
from ..models.activity import ActivityLog
from ..models.job import Job
from ..sources import DiscoveryQuery, discover_all
from ..sources.base import RawJob
from . import dedupe
from .normalize import normalize, split_location


@dataclass
class SourceOutcome:
    source: str
    ok: bool
    fetched: int = 0
    created: int = 0
    updated: int = 0
    duplicates: int = 0
    error: str = ""


@dataclass
class DiscoveryOutcome:
    created: int = 0
    updated: int = 0
    duplicates: int = 0
    fetched: int = 0
    sources: list[SourceOutcome] = field(default_factory=list)

    @property
    def failed_sources(self) -> list[str]:
        return [item.source for item in self.sources if not item.ok]

    @property
    def partial(self) -> bool:
        return bool(self.failed_sources)


def _apply_to_model(job: Job, raw: RawJob) -> None:
    """Copy a normalised posting onto a model row."""
    city, country = split_location(raw.location)
    job.title = raw.title
    job.company = raw.company
    job.company_domain = raw.company_domain
    job.company_logo_url = raw.company_logo_url
    job.canonical_url = raw.canonical_url
    job.application_url = raw.application_url
    job.application_method = raw.application_method
    job.location = raw.location
    job.city = city
    job.country = country
    job.remote_type = raw.remote_type
    job.seniority = raw.seniority
    job.employment_type = raw.employment_type
    job.salary_min = raw.salary_min
    job.salary_max = raw.salary_max
    job.salary_currency = raw.salary_currency
    job.description = raw.description
    job.requirements = raw.requirements
    job.responsibilities = raw.responsibilities
    job.technologies = raw.technologies
    job.benefits = raw.benefits
    job.posted_at = raw.posted_at
    job.raw_payload = raw.raw_payload
    job.content_hash = raw.identity_hash()
    # Set on every pass, new row or existing one: this is the moment the source
    # was asked and still had the posting.
    job.last_seen_at = utcnow()


def persist(db: Session, raws: list[RawJob], source: str) -> SourceOutcome:
    """Store one source's postings, resolving duplicates as they arrive."""
    outcome = SourceOutcome(source=source, ok=True, fetched=len(raws))

    for raw in raws:
        normalize(raw)
        if not raw.title or not raw.company:
            continue

        existing = dedupe.find_existing(db, raw.source, raw.source_job_id)
        if existing is not None:
            _apply_to_model(existing, raw)
            outcome.updated += 1
            continue

        job = Job(source=raw.source, source_job_id=raw.source_job_id)
        _apply_to_model(job, raw)

        original = dedupe.find_duplicate(db, job.content_hash, job.company, job.title)
        if original is not None:
            job.duplicate_of_id = original.id
            outcome.duplicates += 1
        else:
            outcome.created += 1

        db.add(job)
        # Flush per job so the next iteration can see it and treat a repeat
        # within the same batch as a duplicate rather than a second original.
        db.flush()

    return outcome


async def run_discovery(
    db: Session,
    *,
    sources: list[str] | None = None,
    terms: list[str] | None = None,
    locations: list[str] | None = None,
    remote_only: bool = False,
    greenhouse_boards: list[str] | None = None,
    lever_boards: list[str] | None = None,
    limit: int | None = None,
    run_id: int | None = None,
) -> DiscoveryOutcome:
    """Discover from every enabled source and persist the results."""
    settings = get_settings()
    query = DiscoveryQuery(
        terms=terms or [],
        locations=locations or [],
        remote_only=remote_only,
        limit=limit or settings.discovery_max_per_source,
        greenhouse_boards=greenhouse_boards or [],
        lever_boards=lever_boards or [],
    )

    results = await discover_all(sources or [], query)
    outcome = DiscoveryOutcome()

    for result in results:
        if not result.ok:
            outcome.sources.append(SourceOutcome(source=result.source, ok=False, error=result.error))
            db.add(
                ActivityLog(
                    event="discovery.source_failed",
                    level="warning",
                    message=f"{result.source} could not be read: {result.error}",
                    run_id=run_id,
                    details={"source": result.source},
                )
            )
            continue

        source_outcome = persist(db, result.jobs, result.source)
        outcome.sources.append(source_outcome)
        outcome.created += source_outcome.created
        outcome.updated += source_outcome.updated
        outcome.duplicates += source_outcome.duplicates
        outcome.fetched += source_outcome.fetched

    db.add(
        ActivityLog(
            event="discovery.completed",
            level="warning" if outcome.partial else "success",
            message=(
                f"Discovered {outcome.created} new postings from "
                f"{len(results) - len(outcome.failed_sources)} sources."
            ),
            run_id=run_id,
            details={
                "created": outcome.created,
                "updated": outcome.updated,
                "duplicates": outcome.duplicates,
                "failed_sources": outcome.failed_sources,
            },
        )
    )
    db.commit()
    return outcome
