"""Deduplication.

The same vacancy reaches us from several boards with different wording, so an
exact-match check is not enough. Identity is decided in three widening steps,
cheapest first:

1. Same source and source id — the job was already discovered on this board.
2. Same content hash — normalised title, company and city agree exactly.
3. Same company plus a near-identical title — catches "Senior Frontend Engineer"
   against "Frontend Engineer, Senior" and the (m/f/d) suffixes European boards
   add.

A duplicate is never thrown away. It is stored with ``duplicate_of_id`` pointing
at the original, so the interface can show that a role was seen on four boards,
which is itself a signal.
"""
from __future__ import annotations

import re
from difflib import SequenceMatcher

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models.job import Job

#: Noise European and American boards add to titles; removing it before
#: comparison stops "(m/f/d)" from making two identical roles look different.
_TITLE_NOISE = re.compile(
    r"\((?:m/f/d|m/w/d|h/f|f/m/x|m/f/x|remote|hybrid|onsite|[^)]{0,25}contract)\)"
    r"|\b(?:m/f/d|m/w/d|f/m/d)\b",
    re.IGNORECASE,
)
_NON_WORD = re.compile(r"[^a-z0-9 ]+")
_SPACES = re.compile(r"\s+")

#: Words that carry no distinguishing information in a job title.
_STOPWORDS = {"a", "an", "the", "for", "of", "and", "to", "in", "at", "our", "with"}

TITLE_SIMILARITY_THRESHOLD = 0.86


def canonical_title(title: str) -> str:
    """A title reduced to its distinguishing words, order-independent."""
    cleaned = _TITLE_NOISE.sub(" ", title or "").lower()
    cleaned = _NON_WORD.sub(" ", cleaned)
    words = [word for word in _SPACES.split(cleaned) if word and word not in _STOPWORDS]
    return " ".join(sorted(words))


def canonical_company(company: str) -> str:
    """A company name without the legal suffix boards inconsistently include."""
    cleaned = (company or "").lower()
    cleaned = re.sub(
        r"\b(inc|llc|ltd|limited|gmbh|b\.?v|s\.?a|lda|plc|corp|corporation|co)\b\.?",
        " ",
        cleaned,
    )
    cleaned = _NON_WORD.sub(" ", cleaned)
    return _SPACES.sub(" ", cleaned).strip()


def titles_match(left: str, right: str) -> bool:
    """Whether two titles describe the same role."""
    a, b = canonical_title(left), canonical_title(right)
    if not a or not b:
        return False
    if a == b:
        return True
    return SequenceMatcher(None, a, b).ratio() >= TITLE_SIMILARITY_THRESHOLD


def find_existing(db: Session, source: str, source_job_id: str) -> Job | None:
    """Step 1: the same posting on the same board."""
    return db.scalar(
        select(Job).where(Job.source == source, Job.source_job_id == source_job_id)
    )


def find_duplicate(db: Session, content_hash: str, company: str, title: str) -> Job | None:
    """Steps 2 and 3: the same vacancy reached us from somewhere else.

    Only originals are considered, so a chain of duplicates always resolves to
    one canonical job rather than pointing at another duplicate.
    """
    by_hash = db.scalar(
        select(Job).where(Job.content_hash == content_hash, Job.duplicate_of_id.is_(None))
    )
    if by_hash is not None:
        return by_hash

    canonical = canonical_company(company)
    if not canonical:
        return None

    # Candidates are narrowed in SQL by company before the fuzzy title compare,
    # so this stays linear in the number of postings from one company.
    candidates = db.scalars(
        select(Job).where(Job.company.ilike(f"%{company.strip()[:40]}%"), Job.duplicate_of_id.is_(None))
    ).all()
    for candidate in candidates:
        if canonical_company(candidate.company) != canonical:
            continue
        if titles_match(candidate.title, title):
            return candidate
    return None
