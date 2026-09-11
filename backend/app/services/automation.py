"""The automation engine.

One run walks the whole pipeline: discover, normalise, deduplicate, score,
filter, prepare, route for submission, track, follow up, analyse. Each stage
records its own outcome on the run so the interface can show exactly where a run
is and what it did, rather than a spinner.

Three guarantees hold regardless of configuration:

* ``emergency_stop`` halts a run between stages and prevents a new one starting.
* ``dry_run`` prepares everything and sends nothing.
* the daily limit is checked immediately before each submission decision, not
  once at the start, so a limit lowered mid-run takes effect.
"""
from __future__ import annotations

import asyncio
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db.base import utcnow
from ..models.activity import ActivityLog
from ..models.application import Application
from ..models.automation import AutomationConfig, AutomationRun
from ..models.candidate import Candidate
from ..models.enums import PipelineStage, RunStage, RunStatus
from ..models.job import Job
from ..models.job_score import JobScore
from ..sources import DEFAULT_ENABLED
from . import applications as application_service
from .discovery import run_discovery
from .scoring import score_job


class RunCancelled(RuntimeError):
    """Raised when the emergency stop is engaged mid-run."""


@dataclass
class StageReport:
    count: int = 0
    note: str = ""


def get_config(db: Session) -> AutomationConfig:
    """The singleton configuration row, created with safe defaults on first use."""
    config = db.scalar(select(AutomationConfig).limit(1))
    if config is None:
        config = AutomationConfig(
            enabled=False,
            dry_run=True,
            enabled_sources=list(DEFAULT_ENABLED),
            search_terms=[],
        )
        db.add(config)
        db.flush()
    return config


class AutomationEngine:
    """Owns the single in-process run.

    Only one run exists at a time, by design: the pipeline writes to the same
    rows at every stage, and a second concurrent run would race it.
    """

    def __init__(self) -> None:
        self._task: asyncio.Task | None = None
        self._paused = asyncio.Event()
        self._paused.set()
        self._cancelled = False
        self._current_run_id: int | None = None

    # -- state ---------------------------------------------------------------

    @property
    def is_running(self) -> bool:
        return self._task is not None and not self._task.done()

    @property
    def is_paused(self) -> bool:
        return not self._paused.is_set()

    @property
    def current_run_id(self) -> int | None:
        return self._current_run_id

    def pause(self) -> None:
        self._paused.clear()

    def resume(self) -> None:
        self._paused.set()

    def stop(self) -> None:
        self._cancelled = True
        self._paused.set()

    async def _checkpoint(self, db: Session) -> None:
        """Yield between stages, honouring pause and stop."""
        await self._paused.wait()
        if self._cancelled:
            raise RunCancelled("The run was stopped.")
        config = get_config(db)
        if config.emergency_stop:
            raise RunCancelled("Emergency stop is engaged.")

    # -- the pipeline --------------------------------------------------------

    async def run(self, db: Session, candidate: Candidate, *, trigger: str = "manual") -> AutomationRun:
        config = get_config(db)
        blocking = config.blocking_reason()
        if blocking and trigger != "manual":
            raise RunCancelled(blocking)
        if config.emergency_stop:
            raise RunCancelled("Emergency stop is engaged.")

        self._cancelled = False
        self._paused.set()

        run = AutomationRun(
            status=RunStatus.RUNNING,
            trigger=trigger,
            dry_run=config.dry_run,
            started_at=utcnow(),
            stages={},
            config_snapshot={
                "dry_run": config.dry_run,
                "min_score": config.min_score,
                "min_score_to_submit": config.min_score_to_submit,
                "daily_application_limit": config.daily_application_limit,
                "enabled_sources": list(config.enabled_sources or DEFAULT_ENABLED),
            },
        )
        db.add(run)
        db.flush()
        self._current_run_id = run.id

        try:
            await self._execute(db, run, config, candidate)
            run.status = RunStatus.COMPLETED
            run.summary = (
                f"Discovered {run.jobs_discovered}, scored {run.jobs_scored}, "
                f"{run.jobs_eligible} passed the filter, prepared {run.packages_prepared}."
            )
        except RunCancelled as exc:
            run.status = RunStatus.STOPPED
            run.summary = str(exc)
            db.add(ActivityLog(event="automation.stopped", level="warning", message=str(exc), run_id=run.id))
        except Exception as exc:  # noqa: BLE001 - a run failure must be recorded, not raised
            run.status = RunStatus.FAILED
            run.errors = [*(run.errors or []), str(exc)]
            run.summary = f"The run failed: {exc}"
            db.add(ActivityLog(event="automation.failed", level="error", message=str(exc), run_id=run.id))
        finally:
            run.finished_at = utcnow()
            run.current_stage = ""
            self._current_run_id = None
            db.commit()

        return run

    def _begin(self, run: AutomationRun, stage: str) -> None:
        run.current_stage = stage
        stages = dict(run.stages or {})
        stages[stage] = {"status": "running", "started_at": utcnow().isoformat(), "count": 0, "note": ""}
        run.stages = stages

    def _finish(self, run: AutomationRun, stage: str, report: StageReport) -> None:
        stages = dict(run.stages or {})
        entry = dict(stages.get(stage, {}))
        entry.update(
            {
                "status": "completed",
                "finished_at": utcnow().isoformat(),
                "count": report.count,
                "note": report.note,
            }
        )
        stages[stage] = entry
        run.stages = stages

    async def _execute(
        self, db: Session, run: AutomationRun, config: AutomationConfig, candidate: Candidate
    ) -> None:
        # 1-3. Discover, normalise, deduplicate. The discovery service does all
        # three, because a posting is normalised before it can be compared.
        await self._checkpoint(db)
        self._begin(run, RunStage.DISCOVER)
        outcome = await run_discovery(
            db,
            sources=list(config.enabled_sources or DEFAULT_ENABLED),
            terms=list(config.search_terms or candidate.target_roles or []),
            locations=list(config.location_filters or candidate.target_locations or []),
            remote_only=config.remote_only or candidate.remote_only,
            greenhouse_boards=list(config.greenhouse_boards or []),
            lever_boards=list(config.lever_boards or []),
            run_id=run.id,
        )
        run.jobs_discovered = outcome.created
        run.jobs_deduplicated = outcome.duplicates
        if outcome.failed_sources:
            run.errors = [
                *(run.errors or []),
                *[f"{item.source}: {item.error}" for item in outcome.sources if not item.ok],
            ]
        self._finish(
            run,
            RunStage.DISCOVER,
            StageReport(outcome.created, f"{outcome.fetched} fetched, {outcome.created} new."),
        )
        self._finish(run, RunStage.NORMALIZE, StageReport(outcome.fetched, "Normalised on ingest."))
        self._finish(
            run, RunStage.DEDUPLICATE, StageReport(outcome.duplicates, f"{outcome.duplicates} duplicates linked.")
        )

        # 4. Score everything that has no current score.
        await self._checkpoint(db)
        self._begin(run, RunStage.SCORE)
        scored = await self._score_pending(db, candidate, run)
        run.jobs_scored = scored
        self._finish(run, RunStage.SCORE, StageReport(scored, f"{scored} postings scored."))

        # 5. Filter against the guard rails.
        await self._checkpoint(db)
        self._begin(run, RunStage.FILTER)
        eligible = self._filter(db, config, candidate, run)
        run.jobs_eligible = len(eligible)
        self._finish(run, RunStage.FILTER, StageReport(len(eligible), f"{len(eligible)} passed the filter."))

        # 6. Prepare a package for each eligible job.
        await self._checkpoint(db)
        self._begin(run, RunStage.PREPARE)
        prepared = await self._prepare(db, candidate, eligible, config, run)
        run.packages_prepared = prepared
        self._finish(run, RunStage.PREPARE, StageReport(prepared, f"{prepared} packages prepared."))

        # 7. Route for submission.
        await self._checkpoint(db)
        self._begin(run, RunStage.SUBMIT)
        submitted, action_required = self._route(db, config, run)
        run.applications_submitted = submitted
        run.action_required = action_required
        self._finish(
            run,
            RunStage.SUBMIT,
            StageReport(
                submitted,
                (
                    "Dry run, nothing sent."
                    if config.dry_run
                    else f"{action_required} need you to finish them."
                ),
            ),
        )

        # 8-9. Track and follow up.
        await self._checkpoint(db)
        self._begin(run, RunStage.TRACK)
        tracked = db.query(Application).filter(Application.is_archived.is_(False)).count()
        self._finish(run, RunStage.TRACK, StageReport(tracked, f"{tracked} applications tracked."))

        await self._checkpoint(db)
        self._begin(run, RunStage.FOLLOW_UP)
        due = self._schedule_follow_ups(db, config)
        self._finish(run, RunStage.FOLLOW_UP, StageReport(due, f"{due} follow-ups scheduled."))

        # 10. Analyse.
        await self._checkpoint(db)
        self._begin(run, RunStage.ANALYZE)
        self._finish(run, RunStage.ANALYZE, StageReport(0, "Analytics refreshed."))
        db.commit()

    async def _score_pending(self, db: Session, candidate: Candidate, run: AutomationRun) -> int:
        pending = db.scalars(
            select(Job)
            .outerjoin(JobScore, JobScore.job_id == Job.id)
            .where(
                Job.duplicate_of_id.is_(None),
                Job.is_excluded.is_(False),
                JobScore.id.is_(None),
            )
            .limit(400)
        ).all()

        count = 0
        for job in pending:
            await self._checkpoint(db)
            result = await score_job(candidate, job, use_model=True)
            db.add(
                JobScore(
                    job_id=job.id,
                    candidate_id=candidate.id,
                    profile_version=candidate.profile_version,
                    score=result.score,
                    confidence=result.confidence,
                    recommendation=result.recommendation,
                    breakdown=result.breakdown,
                    matched_skills=result.matched_skills,
                    missing_skills=result.missing_skills,
                    strengths=result.strengths,
                    gaps=result.gaps,
                    explanation=result.explanation,
                    method=result.method,
                )
            )
            count += 1
            if count % 20 == 0:
                db.commit()
        db.commit()
        return count

    def _filter(
        self, db: Session, config: AutomationConfig, candidate: Candidate, run: AutomationRun
    ) -> list[Job]:
        excluded = {
            name.strip().lower()
            for name in [*(config.excluded_companies or []), *(candidate.excluded_companies or [])]
            if name.strip()
        }

        rows = db.execute(
            select(Job, JobScore)
            .join(JobScore, JobScore.job_id == Job.id)
            .where(
                Job.duplicate_of_id.is_(None),
                Job.is_excluded.is_(False),
                JobScore.score >= config.min_score,
            )
            .order_by(JobScore.score.desc())
            .limit(200)
        ).all()

        eligible: list[Job] = []
        for job, score in rows:
            if job.company.strip().lower() in excluded:
                job.is_excluded = True
                job.exclusion_reason = "Company is on your exclusion list."
                continue
            if config.remote_only and job.remote_type not in ("remote",):
                continue
            if config.min_salary and (job.salary_max or job.salary_min or 0) < config.min_salary:
                continue
            if config.role_filters and not any(
                term.lower() in job.title.lower() for term in config.role_filters
            ):
                continue
            if job.stage == PipelineStage.DISCOVERED:
                job.stage = PipelineStage.ELIGIBLE
            eligible.append(job)
        db.commit()
        return eligible

    async def _prepare(
        self,
        db: Session,
        candidate: Candidate,
        eligible: list[Job],
        config: AutomationConfig,
        run: AutomationRun,
    ) -> int:
        remaining = max(
            0, config.daily_application_limit - application_service.applications_submitted_today(db)
        )
        prepared = 0
        for job in eligible[:remaining]:
            await self._checkpoint(db)
            existing = db.scalar(select(Application).where(Application.job_id == job.id))
            if existing is not None and existing.package_is_complete:
                continue
            await application_service.prepare_package(db, job, candidate)
            prepared += 1
            db.commit()
        return prepared

    def _route(self, db: Session, config: AutomationConfig, run: AutomationRun) -> tuple[int, int]:
        pending = db.scalars(
            select(Application).where(Application.stage == PipelineStage.PREPARED)
        ).all()

        submitted = 0
        action_required = 0
        for application in pending:
            if application_service.applications_submitted_today(db) >= config.daily_application_limit:
                break
            job = db.get(Job, application.job_id)
            if job is None:
                continue
            stage = application_service.route_for_submission(
                db, application, job, dry_run=config.dry_run
            )
            if stage == PipelineStage.SUBMITTED:
                submitted += 1
            elif stage == PipelineStage.ACTION_REQUIRED:
                action_required += 1
        db.commit()
        return submitted, action_required

    def _schedule_follow_ups(self, db: Session, config: AutomationConfig) -> int:
        from datetime import timedelta

        cutoff = utcnow() - timedelta(days=config.follow_up_after_days)
        stale = db.scalars(
            select(Application).where(
                Application.stage == PipelineStage.SUBMITTED,
                Application.submitted_at.is_not(None),
                Application.submitted_at <= cutoff,
                Application.responded_at.is_(None),
            )
        ).all()
        for application in stale:
            application.follow_up_due = utcnow()
            application.record_stage(
                PipelineStage.FOLLOW_UP,
                f"No response after {config.follow_up_after_days} days.",
                "automation",
            )
        db.commit()
        return len(stale)


#: The process-wide engine. A desktop application has exactly one.
engine = AutomationEngine()
