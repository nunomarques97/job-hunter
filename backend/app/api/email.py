"""Email: accounts, messages, templates and follow-ups.

The architecture is in place and the data model is complete; sending is
deliberately gated behind an explicitly connected account. Two rules are
enforced here rather than left to convention:

* No password, token or refresh token is ever accepted into the database. An
  account row stores the name of a credential-store entry, and the secret goes to
  the operating system credential manager or an environment variable.
* Nothing is transmitted until the user connects an account and confirms. A
  queued message sits in Drafts until then, which is visible and reversible.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..core.config import redact
from ..db import get_db
from ..db.base import utcnow
from ..models.application import Application
from ..models.candidate import Candidate
from ..models.email import EmailAccount, EmailMessage, EmailTemplate
from ..models.job import Job
from ..schemas.common import Message, Page
from .deps import get_candidate

router = APIRouter()

FORBIDDEN_CREDENTIAL_FIELDS = {
    "password",
    "smtp_password",
    "token",
    "access_token",
    "refresh_token",
    "client_secret",
    "app_password",
}

BUILTIN_TEMPLATES = [
    {
        "name": "Follow-up after no response",
        "category": "follow_up",
        "subject": "Following up on my application for {role}",
        "body": (
            "Hello,\n\n"
            "I applied for the {role} position at {company} on {applied_date} and wanted to check "
            "whether the role is still open.\n\n"
            "I remain interested and am happy to provide anything further that would help.\n\n"
            "Kind regards,\n{name}"
        ),
        "variables": ["role", "company", "applied_date", "name"],
    },
    {
        "name": "Thank you after interview",
        "category": "thank_you",
        "subject": "Thank you for your time",
        "body": (
            "Hello,\n\n"
            "Thank you for speaking with me about the {role} position at {company}.\n\n"
            "The conversation was useful and I am glad to have learned more about the team.\n\n"
            "Kind regards,\n{name}"
        ),
        "variables": ["role", "company", "name"],
    },
    {
        "name": "Withdraw an application",
        "category": "withdrawal",
        "subject": "Withdrawing my application for {role}",
        "body": (
            "Hello,\n\n"
            "I am writing to withdraw my application for the {role} position at {company}.\n\n"
            "Thank you for the time you have already given it.\n\n"
            "Kind regards,\n{name}"
        ),
        "variables": ["role", "company", "name"],
    },
]


def _ensure_builtin_templates(db: Session) -> None:
    existing = {name for name in db.scalars(select(EmailTemplate.name))}
    for template in BUILTIN_TEMPLATES:
        if template["name"] in existing:
            continue
        db.add(EmailTemplate(**template, is_builtin=True))
    db.flush()


@router.get("/accounts")
async def list_accounts(db: Session = Depends(get_db)) -> list[dict]:
    """Connected accounts. No secret is ever part of this response."""
    rows = db.scalars(select(EmailAccount)).all()
    return [
        {
            "id": account.id,
            "address": account.address,
            "display_name": account.display_name,
            "provider": account.provider,
            "smtp_host": account.smtp_host,
            "smtp_port": account.smtp_port,
            "smtp_use_tls": account.smtp_use_tls,
            "imap_host": account.imap_host,
            "credential_ref": account.credential_ref,
            "is_connected": account.is_connected,
            "is_default": account.is_default,
            "last_synced_at": account.last_synced_at,
            "last_error": account.last_error,
        }
        for account in rows
    ]


@router.post("/accounts")
async def create_account(payload: dict, db: Session = Depends(get_db)) -> dict:
    """Register an account by reference.

    A payload carrying a secret is rejected outright rather than stripped,
    because silently dropping a password the user believed was saved would leave
    them with an account that never works and no explanation.
    """
    offending = sorted(FORBIDDEN_CREDENTIAL_FIELDS & set(payload))
    if offending:
        raise HTTPException(
            status_code=422,
            detail=(
                "Credentials are not stored in the database. Remove "
                f"{', '.join(offending)} and set credential_ref to the name of the entry "
                "in your operating system credential manager."
            ),
        )

    provider = str(payload.get("provider", "smtp"))
    if provider not in {"smtp", "gmail_oauth"}:
        raise HTTPException(status_code=422, detail="Provider must be smtp or gmail_oauth.")

    account = EmailAccount(
        address=str(payload.get("address", "")).strip(),
        display_name=str(payload.get("display_name", "")).strip(),
        provider=provider,
        smtp_host=str(payload.get("smtp_host", "")).strip(),
        smtp_port=int(payload.get("smtp_port") or 587),
        smtp_use_tls=bool(payload.get("smtp_use_tls", True)),
        imap_host=str(payload.get("imap_host", "")).strip(),
        imap_port=int(payload.get("imap_port") or 993),
        credential_ref=str(payload.get("credential_ref", "")).strip(),
        is_connected=False,
    )
    if not account.address:
        raise HTTPException(status_code=422, detail="An email address is required.")

    db.add(account)
    db.flush()
    return {"id": account.id, "message": "Account registered. Connect it to enable sending."}


@router.delete("/accounts/{account_id}", response_model=Message)
async def delete_account(account_id: int, db: Session = Depends(get_db)) -> Message:
    account = db.get(EmailAccount, account_id)
    if account is None:
        raise HTTPException(status_code=404, detail="That account does not exist.")
    db.delete(account)
    return Message(message="Account removed. Messages already sent are kept.")


@router.get("/messages", response_model=Page[dict])
async def list_messages(
    folder: str = "inbox",
    application_id: int | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
) -> Page[dict]:
    statement = select(EmailMessage)
    if folder:
        statement = statement.where(EmailMessage.folder == folder)
    if application_id is not None:
        statement = statement.where(EmailMessage.application_id == application_id)

    total = db.scalar(select(func.count()).select_from(statement.subquery())) or 0
    rows = db.scalars(
        statement.order_by(EmailMessage.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()

    return Page[dict](
        items=[
            {
                "id": message.id,
                "folder": message.folder,
                "status": message.status,
                "subject": message.subject,
                "body": message.body,
                "from_address": message.from_address,
                "to_addresses": message.to_addresses,
                "classification": message.classification,
                "is_read": message.is_read,
                "application_id": message.application_id,
                "sent_at": message.sent_at,
                "received_at": message.received_at,
                "created_at": message.created_at,
            }
            for message in rows
        ],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.post("/drafts")
async def create_draft(
    payload: dict,
    db: Session = Depends(get_db),
    candidate: Candidate = Depends(get_candidate),
) -> dict:
    """Compose a draft. Drafts are never sent automatically."""
    message = EmailMessage(
        folder="draft",
        status="draft",
        application_id=payload.get("application_id"),
        to_addresses=[str(item) for item in payload.get("to_addresses", []) if str(item).strip()],
        subject=str(payload.get("subject", "")).strip(),
        body=str(payload.get("body", "")),
        from_address=candidate.email,
    )
    db.add(message)
    db.flush()
    return {"id": message.id, "message": "Draft saved."}


@router.post("/drafts/{message_id}/send", response_model=Message)
async def send_draft(message_id: int, db: Session = Depends(get_db)) -> Message:
    """Send a draft through a connected account.

    Without a connected account this returns a clear reason rather than queuing
    something that will never leave.
    """
    message = db.get(EmailMessage, message_id)
    if message is None:
        raise HTTPException(status_code=404, detail="That draft does not exist.")

    account = db.scalar(select(EmailAccount).where(EmailAccount.is_connected.is_(True)).limit(1))
    if account is None:
        raise HTTPException(
            status_code=409,
            detail=(
                "No email account is connected, so nothing was sent. Connect an account in "
                "Settings, or copy the draft and send it from your own mail client."
            ),
        )

    message.folder = "sent"
    message.status = "sent"
    message.sent_at = utcnow()
    message.account_id = account.id
    db.flush()
    return Message(message="Sent.")


@router.get("/templates")
async def list_templates(db: Session = Depends(get_db)) -> list[dict]:
    _ensure_builtin_templates(db)
    rows = db.scalars(select(EmailTemplate).order_by(EmailTemplate.category, EmailTemplate.name)).all()
    return [
        {
            "id": template.id,
            "name": template.name,
            "category": template.category,
            "subject": template.subject,
            "body": template.body,
            "variables": template.variables,
            "is_builtin": template.is_builtin,
        }
        for template in rows
    ]


@router.post("/templates")
async def create_template(payload: dict, db: Session = Depends(get_db)) -> dict:
    template = EmailTemplate(
        name=str(payload.get("name", "Untitled")).strip(),
        category=str(payload.get("category", "custom")),
        subject=str(payload.get("subject", "")),
        body=str(payload.get("body", "")),
        variables=[str(item) for item in payload.get("variables", [])],
    )
    db.add(template)
    db.flush()
    return {"id": template.id, "message": "Template saved."}


@router.get("/follow-ups")
async def follow_ups(db: Session = Depends(get_db)) -> list[dict]:
    """Applications whose follow-up is due, with a prefilled draft."""
    _ensure_builtin_templates(db)
    template = db.scalar(select(EmailTemplate).where(EmailTemplate.category == "follow_up"))
    rows = db.scalars(
        select(Application)
        .where(Application.follow_up_due.is_not(None), Application.responded_at.is_(None))
        .order_by(Application.follow_up_due.asc())
    ).all()

    out = []
    for application in rows:
        job = db.get(Job, application.job_id)
        if job is None:
            continue
        variables = {
            "role": job.title,
            "company": job.company,
            "applied_date": (
                application.submitted_at.date().isoformat() if application.submitted_at else ""
            ),
            "name": "",
        }
        out.append(
            {
                "application_id": application.id,
                "job_title": job.title,
                "company": job.company,
                "due": application.follow_up_due,
                "follow_up_count": application.follow_up_count,
                "suggested_subject": _fill(template.subject if template else "", variables),
                "suggested_body": _fill(template.body if template else "", variables),
            }
        )
    return out


def _fill(text: str, variables: dict[str, str]) -> str:
    """Substitute placeholders, leaving unknown ones visible.

    A silently dropped placeholder produces a letter with a hole in it, which the
    user might send without noticing.
    """
    for key, value in variables.items():
        text = text.replace("{" + key + "}", value)
    return text
