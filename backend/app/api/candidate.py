"""Candidate profile and master CV import."""
from __future__ import annotations

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy.orm import Session

from ..db import get_db
from ..models.candidate import Candidate
from ..models.document import Document
from ..models.enums import DocumentKind
from ..schemas.candidate import CandidateCompleteness, CandidateRead, CandidateUpdate
from ..schemas.common import Message
from ..services.cv_import import ImportPreview, extract_profile, read_upload
from ..services.documents import GeneratedDocument, render_master_cv, store_document
from .deps import completeness, get_candidate

router = APIRouter()

MAX_UPLOAD_BYTES = 5 * 1024 * 1024


@router.get("/", response_model=CandidateRead)
async def read_profile(candidate: Candidate = Depends(get_candidate)) -> Candidate:
    return candidate


@router.put("/", response_model=CandidateRead)
async def update_profile(
    update: CandidateUpdate,
    db: Session = Depends(get_db),
    candidate: Candidate = Depends(get_candidate),
) -> Candidate:
    """Replace the profile.

    Every change bumps ``profile_version``, because a score computed against an
    older profile is no longer the score for this candidate and the interface
    needs to be able to say so.
    """
    payload = update.model_dump()
    for field, value in payload.items():
        if field in {"experience", "education", "projects", "certifications", "languages"}:
            setattr(candidate, field, [entry for entry in value])
        else:
            setattr(candidate, field, value)
    candidate.profile_version += 1
    db.flush()
    return candidate


@router.get("/completeness", response_model=CandidateCompleteness)
async def profile_completeness(candidate: Candidate = Depends(get_candidate)) -> dict:
    return completeness(candidate)


@router.post("/import", response_model=ImportPreview)
async def import_cv(
    file: UploadFile = File(...),
    candidate: Candidate = Depends(get_candidate),
) -> ImportPreview:
    """Extract a profile from an uploaded CV, for the user to review.

    Nothing is written to the profile here. The extraction is returned as a
    preview, and only an explicit confirm applies it, because an import that
    silently overwrote a hand-corrected profile would be the worst bug this
    product could have.
    """
    raw = await file.read(MAX_UPLOAD_BYTES + 1)
    if len(raw) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="That file is larger than 5 MB.")

    text = read_upload(file.filename or "cv", raw)
    if not text.strip():
        raise HTTPException(
            status_code=422,
            detail=(
                "No text could be read from that file. A PDF of scanned images has no "
                "text layer; export a text-based PDF, a DOCX, or paste the text instead."
            ),
        )
    return await extract_profile(text)


@router.post("/import/text", response_model=ImportPreview)
async def import_cv_text(payload: dict) -> ImportPreview:
    """Extract a profile from pasted CV text."""
    text = str(payload.get("text", ""))
    if not text.strip():
        raise HTTPException(status_code=422, detail="No text was provided.")
    return await extract_profile(text)


@router.post("/master-cv", response_model=Message)
async def save_master_cv(
    db: Session = Depends(get_db),
    candidate: Candidate = Depends(get_candidate),
) -> Message:
    """Render the profile to a master CV document and store it as a new version."""
    content = render_master_cv(candidate)
    store_document(
        db,
        candidate=candidate,
        kind=DocumentKind.MASTER_CV,
        generated=GeneratedDocument(content=content, generated_by="template"),
        title="Master CV",
    )
    return Message(message="Master CV saved.")


@router.get("/master-cv")
async def get_master_cv(candidate: Candidate = Depends(get_candidate)) -> dict:
    """The master CV as it would render right now, from the current profile."""
    return {"content": render_master_cv(candidate)}
