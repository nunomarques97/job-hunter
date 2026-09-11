"""Greenhouse job boards.

Greenhouse publishes a public board API for every company that hosts a board:
``https://boards-api.greenhouse.io/v1/boards/{slug}/jobs``. It requires no key
and is the mechanism Greenhouse documents for reading a board programmatically.
"""
from __future__ import annotations

import asyncio
from datetime import datetime

from ..models.enums import ApplicationMethod
from .base import DiscoveryQuery, JobSource, RawJob, SourceCapabilities, strip_html

API = "https://boards-api.greenhouse.io/v1/boards/{slug}/jobs?content=true"

#: Boards used when the user has not chosen any. All are public Greenhouse
#: boards; the user edits this list in Settings.
DEFAULT_BOARDS = [
    "stripe",
    "figma",
    "anthropic",
    "databricks",
    "gitlab",
    "elastic",
    "doordash",
    "robinhood",
]


class GreenhouseSource(JobSource):
    name = "greenhouse"
    label = "Greenhouse boards"

    def capabilities(self) -> SourceCapabilities:
        return SourceCapabilities(
            can_submit=False,
            note=(
                "Reads public company boards. Greenhouse offers no public submission "
                "endpoint, so applications are prepared and opened in your browser."
            ),
        )

    async def fetch(self, query: DiscoveryQuery) -> list[RawJob]:
        boards = query.greenhouse_boards or DEFAULT_BOARDS
        async with self._client() as client:
            results = await asyncio.gather(
                *(self._fetch_board(client, slug, query) for slug in boards),
                return_exceptions=True,
            )
        jobs: list[RawJob] = []
        for item in results:
            if isinstance(item, list):
                jobs.extend(item)
        return jobs

    async def _fetch_board(self, client, slug: str, query: DiscoveryQuery) -> list[RawJob]:
        response = await client.get(API.format(slug=slug))
        response.raise_for_status()
        payload = response.json()

        jobs: list[RawJob] = []
        for entry in payload.get("jobs", []):
            title = entry.get("title", "").strip()
            description = strip_html(entry.get("content", ""))
            if not query.matches_text(title, description):
                continue

            location = (entry.get("location") or {}).get("name", "").strip()
            posted_at = _parse_iso(entry.get("updated_at") or entry.get("first_published"))
            job_id = str(entry.get("id", ""))
            url = entry.get("absolute_url") or f"https://boards.greenhouse.io/{slug}/jobs/{job_id}"

            jobs.append(
                RawJob(
                    source=self.name,
                    source_job_id=f"{slug}:{job_id}",
                    title=title,
                    company=_company_name(entry, slug),
                    canonical_url=url,
                    application_url=url,
                    application_method=ApplicationMethod.EXTERNAL_FORM,
                    location=location,
                    description=description,
                    posted_at=posted_at,
                    raw_payload={
                        "board": slug,
                        "departments": [
                            dept.get("name", "") for dept in entry.get("departments", [])
                        ],
                        "offices": [office.get("name", "") for office in entry.get("offices", [])],
                    },
                )
            )
        return jobs


def _company_name(entry: dict, slug: str) -> str:
    company = (entry.get("company_name") or "").strip()
    return company or slug.replace("-", " ").title()


def _parse_iso(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).replace(tzinfo=None)
    except ValueError:
        return None
