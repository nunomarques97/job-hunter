"""Application preparation and submission routing.

Submission is the part of this product where restraint matters most. The rule
implemented here is simple and has no exceptions:

    An application is transmitted only through a mechanism the recipient
    published for that purpose.

In practice that means email, where the posting gives an address to apply to, and
a source-provided API, where one exists and the user has authorised it. Every
other posting — which is most of them — gets a fully prepared package and the
ACTION_REQUIRED stage, which opens the employer's own form in the user's browser
with everything ready to paste. Nothing here fills a third-party form, drives a
browser session, or works around any control a site has put in place.
"""
from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..db.base import utcnow
from ..models.activity import ActivityLog
from ..models.application import Application
from ..models.candidate import Candidate
from ..models.document import Document
from ..models.enums import ApplicationMethod, DocumentKind, PipelineStage
from ..models.job import Job
from .documents import generate_cover_letter, generate_tailored_cv, store_document


@dataclass
class PreparationResult:
    application: Application
    created: bool
    cv: Document | None = None
    cover_letter: Document | None = None
    blocked_reason: str = ""


def get_or_create_application(db: Session, job: Job, candidate: Candidate) -> tuple[Application, bool]:
    existing = db.scalar(select(Application).where(Application.job_id == job.id))
    if existing is not None:
        return existing, False

    application = Application(
        job_id=job.id,
        candidate_id=candidate.id,
        application_method=job.application_method,
        application_url=job.application_url or job.canonical_url,
        job_snapshot={
            "title": job.title,
            "company": job.company,
            "location": job.location,
            "remote_type": job.remote_type,
            "salary_min": job.salary_min,
            "salary_max": job.salary_max,
            "salary_currency": job.salary_currency,
            "url": job.canonical_url,
            "source": job.source,
            "captured_at": utcnow().isoformat(),
        },
    )
    application.record_stage(PipelineStage.DISCOVERED, "Application created.", "system")
    db.add(application)
    db.flush()
    return application, True


async def prepare_package(
    db: Session,
    job: Job,
    candidate: Candidate,
    *,
    regenerate: bool = False,
) -> PreparationResult:
    """Generate the CV and cover letter and move the application to PREPARED.

    A document that fails the truthfulness check does not stop preparation, but
    it does stop the application from reaching a submittable stage: the package
    lands in ACTION_REQUIRED with the findings attached, for the user to correct.
    """
    application, created = get_or_create_application(db, job, candidate)

    cv_document = application.tailored_cv
    if cv_document is None or regenerate:
        generated = await generate_tailored_cv(candidate, job)
        cv_document = store_document(
            db, candidate=candidate, kind=DocumentKind.TAILORED_CV, generated=generated, job=job
        )
        application.tailored_cv_id = cv_document.id

    letter_document = application.cover_letter
    if letter_document is None or regenerate:
        generated = await generate_cover_letter(candidate, job)
        letter_document = store_document(
            db, candidate=candidate, kind=DocumentKind.COVER_LETTER, generated=generated, job=job
        )
        application.cover_letter_id = letter_document.id

    failures = [
        document
        for document in (cv_document, letter_document)
        if document is not None and not document.truthfulness_passed
    ]

    if failures:
        findings = [finding for document in failures for finding in document.truthfulness_findings]
        reason = "A generated document contains claims that are not on your profile. " + " ".join(
            findings[:2]
        )
        application.action_required_reason = reason
        application.record_stage(PipelineStage.ACTION_REQUIRED, reason, "system")
        db.add(
            ActivityLog(
                event="document.truthfulness_failed",
                level="warning",
                message=reason,
                job_id=job.id,
                application_id=application.id,
                candidate_id=candidate.id,
                details={"findings": findings},
            )
        )
        db.flush()
        return PreparationResult(
            application=application,
            created=created,
            cv=cv_document,
            cover_letter=letter_document,
            blocked_reason=reason,
        )

    application.action_required_reason = ""
    application.record_stage(PipelineStage.PREPARED, "CV and cover letter generated.", "system")
    job.stage = PipelineStage.PREPARED
    db.add(
        ActivityLog(
            event="application.prepared",
            level="success",
            message=f"Package prepared for {job.title} at {job.company}.",
            job_id=job.id,
            application_id=application.id,
            candidate_id=candidate.id,
        )
    )
    db.flush()
    return PreparationResult(
        application=application, created=created, cv=cv_document, cover_letter=letter_document
    )


def can_submit_automatically(application: Application, job: Job) -> tuple[bool, str]:
    """Whether this application has a sanctioned delivery mechanism.

    Returns ``(False, reason)`` for everything that does not, which is the
    common case and not an error.
    """
    if not application.package_is_complete:
        return False, "The application package is not complete yet."

    method = application.application_method or job.application_method
    if method == ApplicationMethod.EMAIL:
        return True, ""
    if method == ApplicationMethod.API:
        return True, ""
    if method == ApplicationMethod.EXTERNAL_FORM:
        return False, (
            "This employer accepts applications only through their own web form. "
            "The package is ready; open the posting to submit it."
        )
    return False, (
        "This posting gives no documented way to submit programmatically. "
        "The package is ready for you to send."
    )


def route_for_submission(db: Session, application: Application, job: Job, *, dry_run: bool) -> str:
    """Decide what happens to a prepared application, and record it.

    Returns the stage the application ended in.
    """
    allowed, reason = can_submit_automatically(application, job)

    if dry_run:
        note = "Dry run: nothing was sent. " + (reason or "This application would have been submitted.")
        application.action_required_reason = note
        application.record_stage(PipelineStage.READY, note, "automation")
        db.add(
            ActivityLog(
                event="application.dry_run",
                level="info",
                message=note,
                job_id=job.id,
                application_id=application.id,
            )
        )
        return PipelineStage.READY

    if not allowed:
        application.action_required_reason = reason
        application.record_stage(PipelineStage.ACTION_REQUIRED, reason, "automation")
        db.add(
            ActivityLog(
                event="application.action_required",
                level="warning",
                message=f"{job.title} at {job.company}: {reason}",
                job_id=job.id,
                application_id=application.id,
            )
        )
        return PipelineStage.ACTION_REQUIRED

    # Email delivery is handled by the email service, which the user connects
    # explicitly. Until an account is connected this stays READY rather than
    # pretending something was sent.
    application.record_stage(
        PipelineStage.READY,
        "Ready to send by email once an email account is connected.",
        "automation",
    )
    return PipelineStage.READY


def mark_submitted(db: Session, application: Application, *, note: str = "") -> None:
    """Record that the user, or a sanctioned channel, actually sent this."""
    application.submitted_at = utcnow()
    application.action_required_reason = ""
    application.record_stage(PipelineStage.SUBMITTED, note or "Marked as submitted.", "user")
    db.add(
        ActivityLog(
            event="application.submitted",
            level="success",
            message=note or "Application marked as submitted.",
            application_id=application.id,
            job_id=application.job_id,
        )
    )


def applications_submitted_today(db: Session) -> int:
    """Used to enforce the daily limit."""
    start = utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    return (
        db.scalar(
            select(func.count(Application.id)).where(Application.submitted_at.is_not(None), Application.submitted_at >= start)
        )
        or 0
    )
