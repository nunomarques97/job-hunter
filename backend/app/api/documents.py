"""CV and cover-letter documents, with version history and export."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models.candidate import Candidate
from ..models.document import Document
from ..models.enums import DocumentKind
from ..models.job import Job
from ..schemas.application import DocumentDetail, DocumentSummary
from ..schemas.common import Message, Page
from ..services.documents import (
    generate_cover_letter,
    generate_tailored_cv,
    store_document,
)
from .deps import get_candidate, require_complete_profile

router = APIRouter()


@router.get("/", response_model=Page[DocumentSummary])
async def list_documents(
    kind: str = "",
    job_id: int | None = None,
    current_only: bool = True,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
    candidate: Candidate = Depends(get_candidate),
) -> Page[DocumentSummary]:
    statement = select(Document).where(Document.candidate_id == candidate.id)
    if kind:
        statement = statement.where(Document.kind == kind)
    if job_id is not None:
        statement = statement.where(Document.job_id == job_id)
    if current_only:
        statement = statement.where(Document.is_current.is_(True))

    total = db.scalar(select(func.count()).select_from(statement.subquery())) or 0
    rows = db.scalars(
        statement.order_by(Document.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()
    return Page[DocumentSummary](
        items=[DocumentSummary.model_validate(row) for row in rows],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get("/{document_id}", response_model=DocumentDetail)
async def get_document(document_id: int, db: Session = Depends(get_db)) -> DocumentDetail:
    document = db.get(Document, document_id)
    if document is None:
        raise HTTPException(status_code=404, detail="That document does not exist.")
    return DocumentDetail.model_validate(document)


@router.get("/{document_id}/versions", response_model=list[DocumentSummary])
async def document_versions(document_id: int, db: Session = Depends(get_db)) -> list[DocumentSummary]:
    """Every version of this document, newest first."""
    document = db.get(Document, document_id)
    if document is None:
        raise HTTPException(status_code=404, detail="That document does not exist.")
    rows = db.scalars(
        select(Document)
        .where(
            Document.candidate_id == document.candidate_id,
            Document.lineage_key == document.lineage_key,
        )
        .order_by(Document.version.desc())
    ).all()
    return [DocumentSummary.model_validate(row) for row in rows]


@router.post("/{document_id}/restore", response_model=DocumentDetail)
async def restore_version(document_id: int, db: Session = Depends(get_db)) -> DocumentDetail:
    """Make an older version current again, without deleting anything."""
    document = db.get(Document, document_id)
    if document is None:
        raise HTTPException(status_code=404, detail="That document does not exist.")

    siblings = db.scalars(
        select(Document).where(
            Document.candidate_id == document.candidate_id,
            Document.lineage_key == document.lineage_key,
        )
    ).all()
    for sibling in siblings:
        sibling.is_current = sibling.id == document.id
    db.flush()
    return DocumentDetail.model_validate(document)


@router.patch("/{document_id}", response_model=DocumentDetail)
async def edit_document(
    document_id: int,
    payload: dict,
    db: Session = Depends(get_db),
    candidate: Candidate = Depends(get_candidate),
) -> DocumentDetail:
    """Save a user edit as a new version.

    The edit is not applied in place: what was already sent for an application
    must stay readable exactly as it was sent.
    """
    document = db.get(Document, document_id)
    if document is None:
        raise HTTPException(status_code=404, detail="That document does not exist.")

    content = str(payload.get("content", "")).strip()
    if not content:
        raise HTTPException(status_code=422, detail="The document cannot be empty.")

    from ..services.documents import GeneratedDocument

    job = db.get(Job, document.job_id) if document.job_id else None
    new_version = store_document(
        db,
        candidate=candidate,
        kind=document.kind,
        generated=GeneratedDocument(content=content, generated_by="user"),
        job=job,
        title=document.title,
    )
    return DocumentDetail.model_validate(new_version)


@router.post("/generate/cv/{job_id}", response_model=DocumentDetail)
async def generate_cv(
    job_id: int,
    db: Session = Depends(get_db),
    candidate: Candidate = Depends(require_complete_profile),
) -> DocumentDetail:
    job = db.get(Job, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="That job is not in your database.")
    generated = await generate_tailored_cv(candidate, job)
    document = store_document(
        db, candidate=candidate, kind=DocumentKind.TAILORED_CV, generated=generated, job=job
    )
    db.commit()
    return DocumentDetail.model_validate(document)


@router.post("/generate/cover-letter/{job_id}", response_model=DocumentDetail)
async def generate_letter(
    job_id: int,
    db: Session = Depends(get_db),
    candidate: Candidate = Depends(require_complete_profile),
) -> DocumentDetail:
    job = db.get(Job, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="That job is not in your database.")
    generated = await generate_cover_letter(candidate, job)
    document = store_document(
        db, candidate=candidate, kind=DocumentKind.COVER_LETTER, generated=generated, job=job
    )
    db.commit()
    return DocumentDetail.model_validate(document)


@router.get("/{document_id}/export")
async def export_document(
    document_id: int,
    fmt: str = Query(default="md", pattern="^(md|txt|html)$"),
    db: Session = Depends(get_db),
) -> Response:
    """Download a document.

    Markdown and plain text are exact. HTML is a styled render intended for the
    browser's own print-to-PDF, which avoids shipping a PDF engine and produces a
    result the user can see before committing to it.
    """
    document = db.get(Document, document_id)
    if document is None:
        raise HTTPException(status_code=404, detail="That document does not exist.")

    safe_name = "".join(
        character for character in document.title if character.isalnum() or character in " -_"
    ).strip() or "document"

    if fmt == "md":
        return Response(
            content=document.content,
            media_type="text/markdown; charset=utf-8",
            headers={"Content-Disposition": f'attachment; filename="{safe_name}.md"'},
        )
    if fmt == "txt":
        import re

        plain = re.sub(r"^#{1,6}\s*", "", document.content, flags=re.MULTILINE)
        plain = re.sub(r"\*\*(.+?)\*\*", r"\1", plain)
        plain = re.sub(r"\*(.+?)\*", r"\1", plain)
        return Response(
            content=plain,
            media_type="text/plain; charset=utf-8",
            headers={"Content-Disposition": f'attachment; filename="{safe_name}.txt"'},
        )

    return Response(
        content=_render_html(document),
        media_type="text/html; charset=utf-8",
    )


def _render_html(document: Document) -> str:
    """A print-ready HTML render of a Markdown document."""
    import html
    import re

    body = html.escape(document.content)
    body = re.sub(r"^### (.+)$", r"<h3>\1</h3>", body, flags=re.MULTILINE)
    body = re.sub(r"^## (.+)$", r"<h2>\1</h2>", body, flags=re.MULTILINE)
    body = re.sub(r"^# (.+)$", r"<h1>\1</h1>", body, flags=re.MULTILINE)
    body = re.sub(r"^- (.+)$", r"<li>\1</li>", body, flags=re.MULTILINE)
    body = re.sub(r"(<li>.*?</li>\n?)+", lambda m: f"<ul>{m.group(0)}</ul>", body, flags=re.DOTALL)
    body = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", body)
    body = re.sub(r"\*(.+?)\*", r"<em>\1</em>", body)
    body = "\n".join(
        line if line.startswith("<") else (f"<p>{line}</p>" if line.strip() else "")
        for line in body.splitlines()
    )

    return f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>{html.escape(document.title)}</title>
<style>
  @page {{ margin: 18mm 16mm; }}
  body {{ font: 11pt/1.5 Georgia, 'Times New Roman', serif; color: #111; max-width: 720px; margin: 0 auto; padding: 24px; }}
  h1 {{ font-size: 20pt; margin: 0 0 4px; letter-spacing: -0.01em; }}
  h2 {{ font-size: 12pt; text-transform: uppercase; letter-spacing: .08em; border-bottom: 1px solid #999; padding-bottom: 3px; margin: 20px 0 8px; }}
  h3 {{ font-size: 11.5pt; margin: 12px 0 2px; }}
  p, li {{ margin: 3px 0; }}
  ul {{ margin: 4px 0 8px 18px; padding: 0; }}
  em {{ color: #555; }}
</style></head><body>{body}</body></html>"""


@router.delete("/{document_id}", response_model=Message)
async def delete_document(document_id: int, db: Session = Depends(get_db)) -> Message:
    document = db.get(Document, document_id)
    if document is None:
        raise HTTPException(status_code=404, detail="That document does not exist.")
    if document.is_current:
        raise HTTPException(
            status_code=409,
            detail="This is the current version. Restore another version before deleting it.",
        )
    db.delete(document)
    return Message(message="Version deleted.")
