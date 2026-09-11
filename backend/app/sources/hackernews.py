"""Hacker News "Who is hiring" threads, read through the public Algolia API.

Algolia hosts the official HN search API at ``hn.algolia.com/api/v1``, which is
public and documented. This source finds the newest hiring thread and reads its
top-level comments, each of which is one company's posting.
"""
from __future__ import annotations

import re
from datetime import datetime, timezone

from ..models.enums import ApplicationMethod, RemoteType
from .base import DiscoveryQuery, JobSource, RawJob, SourceCapabilities, strip_html

SEARCH = "https://hn.algolia.com/api/v1/search"
ITEM = "https://hn.algolia.com/api/v1/items/{item_id}"

# The convention in these threads is "Company | Role | Location | tags".
_SEPARATORS = re.compile(r"\s*(?:\||–|—| - )\s*")
_REMOTE_RE = re.compile(r"\bremote\b", re.IGNORECASE)
_HYBRID_RE = re.compile(r"\bhybrid\b", re.IGNORECASE)
_URL_RE = re.compile(r"https?://[^\s<>\"')]+")


class HackerNewsSource(JobSource):
    name = "hackernews"
    label = "HN Who is hiring"

    def capabilities(self) -> SourceCapabilities:
        return SourceCapabilities(
            can_submit=False,
            note=(
                "Monthly hiring thread. Postings are free text, so fields are parsed "
                "best-effort and always kept alongside the original comment."
            ),
        )

    async def fetch(self, query: DiscoveryQuery) -> list[RawJob]:
        async with self._client() as client:
            search = await client.get(
                SEARCH,
                params={
                    "query": "Ask HN: Who is hiring",
                    "tags": "story,author_whoishiring",
                    "hitsPerPage": 1,
                },
            )
            search.raise_for_status()
            hits = search.json().get("hits", [])
            if not hits:
                return []

            thread_id = hits[0].get("objectID")
            thread_title = hits[0].get("title", "Who is hiring")

            item = await client.get(ITEM.format(item_id=thread_id))
            item.raise_for_status()
            children = item.json().get("children", [])

        jobs: list[RawJob] = []
        for child in children:
            text = strip_html(child.get("text") or "")
            if not text or child.get("author") == "whoishiring":
                continue

            first_line = text.splitlines()[0]
            parts = [part.strip() for part in _SEPARATORS.split(first_line) if part.strip()]
            if len(parts) < 2:
                continue

            company = parts[0][:120]
            title = parts[1][:200]
            location = parts[2][:120] if len(parts) > 2 else ""

            if not query.matches_text(title, company, text):
                continue

            remote_type = RemoteType.UNKNOWN
            if _REMOTE_RE.search(first_line):
                remote_type = RemoteType.REMOTE
            elif _HYBRID_RE.search(first_line):
                remote_type = RemoteType.HYBRID

            urls = _URL_RE.findall(text)
            created = child.get("created_at_i")
            posted_at = (
                datetime.fromtimestamp(created, tz=timezone.utc).replace(tzinfo=None)
                if isinstance(created, (int, float))
                else None
            )

            jobs.append(
                RawJob(
                    source=self.name,
                    source_job_id=str(child.get("id")),
                    title=title,
                    company=company,
                    canonical_url=f"https://news.ycombinator.com/item?id={child.get('id')}",
                    application_url=urls[0] if urls else "",
                    application_method=(
                        ApplicationMethod.EXTERNAL_FORM if urls else ApplicationMethod.MANUAL
                    ),
                    location=location,
                    remote_type=remote_type,
                    description=text,
                    posted_at=posted_at,
                    raw_payload={"thread": thread_title, "author": child.get("author", "")},
                )
            )
        return jobs
