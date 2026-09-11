"""LLM provider registry.

The application never constructs a provider directly; it asks here, so swapping
Ollama for another backend is a one-line change and every caller keeps working.
"""
from __future__ import annotations

from ..core.config import get_settings
from .base import (
    GenerationResult,
    LLMProvider,
    LLMUnavailable,
    Message,
    ModelInfo,
    ProviderStatus,
    extract_json,
    wrap_untrusted,
)
from .ollama import OllamaProvider

#: A provider class registered here takes an optional ``model`` keyword. That
#: is the registry's only requirement beyond :class:`LLMProvider`, and it is
#: what lets one stage be pinned to a different tag from another.
_PROVIDERS: dict[str, type[LLMProvider]] = {"ollama": OllamaProvider}

#: One instance per model tag. Stages that share a tag share the client and its
#: connection pool; a pinned stage gets its own.
_instances: dict[str, LLMProvider] = {}


def register_provider(name: str, provider: type[LLMProvider]) -> None:
    _PROVIDERS[name] = provider


def get_llm(stage: str | None = None) -> LLMProvider:
    """The provider for ``stage``, or for the default model when unnamed.

    Passing the stage is what keeps the diagnostic panel honest: the panel
    reads the same ``model_for`` mapping, so the tag it names for a stage is
    the tag that stage will really call.
    """
    settings = get_settings()
    model = settings.model_for(stage)
    instance = _instances.get(model)
    if instance is None:
        factory = _PROVIDERS.get(settings.llm_provider)
        if factory is None:
            raise ValueError(
                f"Unknown LLM provider {settings.llm_provider!r}. "
                f"Known providers: {', '.join(sorted(_PROVIDERS))}."
            )
        instance = factory(model=model)  # type: ignore[call-arg]
        _instances[model] = instance
    return instance


async def close_llm() -> None:
    for instance in list(_instances.values()):
        await instance.aclose()
    _instances.clear()


__all__ = [
    "GenerationResult",
    "LLMProvider",
    "LLMUnavailable",
    "Message",
    "ModelInfo",
    "OllamaProvider",
    "ProviderStatus",
    "close_llm",
    "extract_json",
    "get_llm",
    "register_provider",
    "wrap_untrusted",
]
