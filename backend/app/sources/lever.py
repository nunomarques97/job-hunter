"""Lever job boards.

Lever publishes a public postings API per company:
``https://api.lever.co/v0/postings/{slug}?mode=json``. No key, no session, and
documented by Lever for reading a public board.
"""
from __future__ import annotations

import asyncio
from datetime import datetime, timezone

from ..models.enums import ApplicationMethod, RemoteType
from .base import DiscoveryQuery, JobSource, RawJob, SourceCapabilities, strip_html

API = "https://api.lever.co/v0/postings/{slug}?mode=json"

DEFAULT_BOARDS = ["netflix", "spotify", "plaid", "brex", "ramp", "mistral"]


class LeverSource(JobSource):
    name = "lever"
    label = "Lever boards"

    def capabilities(self) -> SourceCapabilities:
        return SourceCapabilities(
            can_submit=False,
            note=(
                "Reads public company boards. Submission happens on Lever's own hosted "
                "form, which the application opens for you with the package ready."
            ),
        )

    async def fetch(self, query: DiscoveryQuery) -> list[RawJob]:
        boards = query.lever_boards or DEFAULT_BOARDS
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
        postings = response.json()
        if not isinstance(postings, list):
            return []

        jobs: list[RawJob] = []
        for entry in postings:
            title = (entry.get("text") or "").strip()
            description = entry.get("descriptionPlain") or strip_html(entry.get("description", ""))
            extra = "\n\n".join(
                f"{block.get('text', '')}\n{strip_html(block.get('content', ''))}"
                for block in entry.get("lists", [])
            )
            body = f"{description}\n\n{extra}".strip()
            if not query.matches_text(title, body):
                continue

            categories = entry.get("categories") or {}
            location = (categories.get("location") or "").strip()
            workplace = (entry.get("workplaceType") or "").strip().lower()
            remote_type = {
                "remote": RemoteType.REMOTE,
                "hybrid": RemoteType.HYBRID,
                "onsite": RemoteType.ONSITE,
            }.get(workplace, RemoteType.UNKNOWN)

            posted_at = None
            created = entry.get("createdAt")
            if isinstance(created, (int, float)):
                posted_at = datetime.fromtimestamp(created / 1000, tz=timezone.utc).replace(
                    tzinfo=None
                )

            url = entry.get("hostedUrl", "")
            jobs.append(
                RawJob(
                    source=self.name,
                    source_job_id=f"{slug}:{entry.get('id', '')}",
                    title=title,
                    company=slug.replace("-", " ").title(),
                    canonical_url=url,
                    application_url=entry.get("applyUrl") or url,
                    application_method=ApplicationMethod.EXTERNAL_FORM,
                    location=location,
                    remote_type=remote_type,
                    employment_type=(categories.get("commitment") or "").strip(),
                    description=body,
                    posted_at=posted_at,
                    raw_payload={
                        "board": slug,
                        "team": categories.get("team", ""),
                        "department": categories.get("department", ""),
                    },
                )
            )
        return jobs
