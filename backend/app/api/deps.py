"""Shared route dependencies."""
from __future__ import annotations

from fastapi import Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models.candidate import Candidate

#: Required profile fields before document generation is allowed, with the label
#: shown to the user when one is missing.
REQUIRED_FIELDS = [
    ("full_name", "Your name"),
    ("email", "Email address"),
    ("headline", "Professional headline"),
    ("summary", "Professional summary"),
    ("experience", "At least one role in Experience"),
    ("technologies", "Technologies"),
    ("target_roles", "Target roles"),
]


def get_candidate(db: Session = Depends(get_db)) -> Candidate:
    """The active candidate, created empty on first run.

    A desktop application has exactly one user, so this never needs an identity
    check. The row is created rather than 404ing, because a first-run user
    opening the Profile screen should find a form, not an error.
    """
    candidate = db.scalar(select(Candidate).where(Candidate.is_active.is_(True)).limit(1))
    if candidate is None:
        candidate = Candidate(full_name="", is_active=True)
        db.add(candidate)
        db.flush()
    return candidate


def require_complete_profile(candidate: Candidate = Depends(get_candidate)) -> Candidate:
    """Reject generation against a profile too empty to produce a truthful CV."""
    missing = [label for field, label in REQUIRED_FIELDS if not getattr(candidate, field, None)]
    if missing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "message": "Your profile is missing information a truthful CV needs.",
                "missing": missing,
            },
        )
    return candidate


def completeness(candidate: Candidate) -> dict:
    missing = [label for field, label in REQUIRED_FIELDS if not getattr(candidate, field, None)]
    filled = len(REQUIRED_FIELDS) - len(missing)
    return {
        "percent": round(filled / len(REQUIRED_FIELDS) * 100),
        "missing": missing,
        "ready_for_generation": not missing,
    }
