"""RemoteOK.

RemoteOK publishes its listings as a public JSON feed at
``https://remoteok.com/api``, which it offers for reuse provided the original
posting is linked. Every job stored from here keeps its ``canonical_url``, and
the interface links back to it.
"""
from __future__ import annotations

from datetime import datetime, timezone

from ..models.enums import ApplicationMethod, RemoteType
from .base import DiscoveryQuery, JobSource, RawJob, SourceCapabilities, strip_html

API = "https://remoteok.com/api"


class RemoteOkSource(JobSource):
    name = "remoteok"
    label = "RemoteOK"

    def capabilities(self) -> SourceCapabilities:
        return SourceCapabilities(
            can_submit=False,
            note="Public remote-work feed. Links back to the original posting to apply.",
        )

    async def fetch(self, query: DiscoveryQuery) -> list[RawJob]:
        async with self._client() as client:
            response = await client.get(API)
            response.raise_for_status()
            payload = response.json()

        if not isinstance(payload, list):
            return []

        jobs: list[RawJob] = []
        for entry in payload:
            # The first element of the feed is a legal notice, not a job.
            if not isinstance(entry, dict) or not entry.get("id"):
                continue

            title = (entry.get("position") or entry.get("title") or "").strip()
            company = (entry.get("company") or "").strip()
            description = strip_html(entry.get("description", ""))
            tags = [str(tag).strip() for tag in entry.get("tags", []) if str(tag).strip()]
            if not title or not company:
                continue
            if not query.matches_text(title, description, " ".join(tags)):
                continue

            posted_at = None
            epoch = entry.get("epoch")
            if isinstance(epoch, (int, float)):
                posted_at = datetime.fromtimestamp(epoch, tz=timezone.utc).replace(tzinfo=None)

            url = entry.get("url", "")
            jobs.append(
                RawJob(
                    source=self.name,
                    source_job_id=str(entry["id"]),
                    title=title,
                    company=company,
                    canonical_url=url,
                    application_url=entry.get("apply_url") or url,
                    application_method=ApplicationMethod.EXTERNAL_FORM,
                    location=(entry.get("location") or "Remote").strip(),
                    remote_type=RemoteType.REMOTE,
                    description=description,
                    # Tags are free-form on this source, so they feed detection
                    # rather than being trusted as technologies outright.
                    technologies=[],
                    salary_min=_as_number(entry.get("salary_min")),
                    salary_max=_as_number(entry.get("salary_max")),
                    salary_currency="USD" if entry.get("salary_min") else "",
                    company_logo_url=entry.get("company_logo") or entry.get("logo") or "",
                    posted_at=posted_at,
                    raw_payload={"tags": tags, "tag_text": " ".join(tags)},
                )
            )
        return jobs


def _as_number(value) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if number > 0 else None
