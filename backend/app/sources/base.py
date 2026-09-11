"""Job source contract.

Every source in this package reads a public, documented endpoint that the
publisher offers for programmatic access, identifies itself honestly through a
User-Agent, and respects the rate the publisher advertises. No source here
authenticates as a user it is not, works around a challenge, or retrieves
anything an anonymous visitor could not.

A source that cannot legitimately submit an application says so through
:attr:`SourceCapabilities.can_submit`. That is the normal case, and it routes the
prepared package to ACTION_REQUIRED rather than to any unsanctioned automation.
"""
from __future__ import annotations

import asyncio
import hashlib
import html
import re
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

import httpx

from ..core.config import get_settings
from ..models.enums import ApplicationMethod, RemoteType, Seniority


@dataclass
class RawJob:
    """A posting as the source described it, before normalisation."""

    source: str
    source_job_id: str
    title: str
    company: str
    canonical_url: str = ""
    application_url: str = ""
    application_method: str = ApplicationMethod.MANUAL
    location: str = ""
    remote_type: str = RemoteType.UNKNOWN
    seniority: str = Seniority.UNKNOWN
    employment_type: str = ""
    description: str = ""
    requirements: str = ""
    responsibilities: str = ""
    technologies: list[str] = field(default_factory=list)
    benefits: list[str] = field(default_factory=list)
    salary_min: float | None = None
    salary_max: float | None = None
    salary_currency: str = ""
    company_domain: str = ""
    company_logo_url: str = ""
    posted_at: datetime | None = None
    raw_payload: dict[str, Any] = field(default_factory=dict)

    def identity_hash(self) -> str:
        """Content identity used for cross-source deduplication."""
        basis = "|".join(
            [
                _slug(self.title),
                _slug(self.company),
                _slug(self.location.split(",")[0] if self.location else ""),
            ]
        )
        return hashlib.sha256(basis.encode("utf-8")).hexdigest()


@dataclass
class SourceCapabilities:
    can_discover: bool = True
    can_submit: bool = False
    requires_credentials: bool = False
    #: Plain sentence shown in Settings explaining what this source can do.
    note: str = ""


@dataclass
class SourceResult:
    source: str
    jobs: list[RawJob] = field(default_factory=list)
    ok: bool = True
    error: str = ""


_SLUG_RE = re.compile(r"[^a-z0-9]+")


def _slug(value: str) -> str:
    return _SLUG_RE.sub("-", (value or "").lower()).strip("-")


_TAG_RE = re.compile(r"<[^>]+>")
_WS_RE = re.compile(r"[ \t\r\f\v]+")


def strip_html(value: str) -> str:
    """Turn source HTML into readable plain text.

    Block-level tags become newlines first so that requirement lists survive as
    lines rather than collapsing into one paragraph.
    """
    if not value:
        return ""
    text = re.sub(r"(?i)<br\s*/?>", "\n", value)
    text = re.sub(r"(?i)</(p|div|li|ul|ol|h[1-6]|tr)>", "\n", text)
    text = re.sub(r"(?i)<li[^>]*>", "- ", text)
    text = _TAG_RE.sub(" ", text)
    # Sources emit named and numeric entities alike, so decode both rather than
    # a hand-written shortlist; a title reading "Programmer&#x2F;Developer" is
    # the kind of thing a shortlist misses.
    text = html.unescape(text).replace(" ", " ")
    text = _WS_RE.sub(" ", text)
    text = re.sub(r"\n\s*\n\s*\n+", "\n\n", text)
    return "\n".join(line.strip() for line in text.splitlines()).strip()


class JobSource(ABC):
    """Base class handling the HTTP client and failure isolation."""

    #: Stable key stored on every job row.
    name: str = "base"
    #: Shown in the interface.
    label: str = "Base"

    def __init__(self) -> None:
        self.settings = get_settings()

    def capabilities(self) -> SourceCapabilities:
        return SourceCapabilities(
            note="Discovery only. Applications are prepared for you to submit."
        )

    def _client(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(
            timeout=httpx.Timeout(self.settings.http_timeout_seconds, connect=8.0),
            headers={"User-Agent": self.settings.user_agent, "Accept": "application/json"},
            follow_redirects=True,
        )

    @abstractmethod
    async def fetch(self, query: "DiscoveryQuery") -> list[RawJob]:
        """Return postings for ``query``. May raise; ``discover`` isolates it."""

    async def discover(self, query: "DiscoveryQuery") -> SourceResult:
        """Run :meth:`fetch` and never raise.

        One failing source must not take the run down, and the failure is
        reported rather than hidden, so a partial result is never presented as a
        complete one.
        """
        try:
            jobs = await self.fetch(query)
        except asyncio.TimeoutError:
            return SourceResult(source=self.name, ok=False, error="The source timed out.")
        except httpx.HTTPStatusError as exc:
            return SourceResult(
                source=self.name,
                ok=False,
                error=f"The source returned HTTP {exc.response.status_code}.",
            )
        except httpx.HTTPError as exc:
            return SourceResult(source=self.name, ok=False, error=f"Network error: {exc}")
        except Exception as exc:  # noqa: BLE001 - a source must never break a run
            return SourceResult(source=self.name, ok=False, error=str(exc))
        limit = self.settings.discovery_max_per_source
        return SourceResult(source=self.name, jobs=jobs[:limit], ok=True)


@dataclass
class DiscoveryQuery:
    """What to look for. Sources ignore the parts they cannot express."""

    terms: list[str] = field(default_factory=list)
    locations: list[str] = field(default_factory=list)
    remote_only: bool = False
    limit: int = 100
    #: Company board slugs, for the ATS sources.
    greenhouse_boards: list[str] = field(default_factory=list)
    lever_boards: list[str] = field(default_factory=list)

    def matches_text(self, *parts: str) -> bool:
        """Loose keyword gate.

        Discovery is deliberately permissive; the scorer decides relevance. A
        term list that is empty matches everything.
        """
        if not self.terms:
            return True
        haystack = " ".join(part.lower() for part in parts if part)
        return any(term.lower().strip() in haystack for term in self.terms if term.strip())
