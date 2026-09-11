"""Job source registry."""
from __future__ import annotations

import asyncio

from .base import (
    DiscoveryQuery,
    JobSource,
    RawJob,
    SourceCapabilities,
    SourceResult,
    strip_html,
)
from .greenhouse import GreenhouseSource
from .hackernews import HackerNewsSource
from .lever import LeverSource
from .remoteok import RemoteOkSource
from .sample import SampleSource

_SOURCES: dict[str, type[JobSource]] = {
    source.name: source
    for source in (
        GreenhouseSource,
        LeverSource,
        RemoteOkSource,
        HackerNewsSource,
        SampleSource,
    )
}

#: Enabled when the user has expressed no preference. The network sources that
#: need no configuration, plus the offline sample set.
DEFAULT_ENABLED = ["remoteok", "hackernews", "greenhouse", "sample"]


def available_sources() -> list[dict[str, object]]:
    """Describe every source for the Settings screen."""
    descriptions = []
    for name, factory in _SOURCES.items():
        instance = factory()
        capabilities = instance.capabilities()
        descriptions.append(
            {
                "name": name,
                "label": instance.label,
                "can_discover": capabilities.can_discover,
                "can_submit": capabilities.can_submit,
                "requires_credentials": capabilities.requires_credentials,
                "note": capabilities.note,
            }
        )
    return sorted(descriptions, key=lambda item: str(item["label"]))


def get_source(name: str) -> JobSource:
    factory = _SOURCES.get(name)
    if factory is None:
        raise KeyError(f"Unknown job source {name!r}.")
    return factory()


async def discover_all(names: list[str], query: DiscoveryQuery) -> list[SourceResult]:
    """Run every named source concurrently.

    Failures are returned as unsuccessful results rather than raised, so one
    unreachable board never costs the run the jobs the others found.
    """
    selected = [name for name in names if name in _SOURCES] or DEFAULT_ENABLED
    sources = [get_source(name) for name in selected]
    return list(await asyncio.gather(*(source.discover(query) for source in sources)))


__all__ = [
    "DEFAULT_ENABLED",
    "DiscoveryQuery",
    "JobSource",
    "RawJob",
    "SourceCapabilities",
    "SourceResult",
    "available_sources",
    "discover_all",
    "get_source",
    "strip_html",
]
