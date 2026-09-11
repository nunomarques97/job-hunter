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
    extract_json,
    wrap_untrusted,
)
from .ollama import OllamaProvider

_PROVIDERS: dict[str, type[LLMProvider]] = {"ollama": OllamaProvider}

_instance: LLMProvider | None = None


def register_provider(name: str, provider: type[LLMProvider]) -> None:
    _PROVIDERS[name] = provider


def get_llm() -> LLMProvider:
    """The process-wide provider instance."""
    global _instance
    if _instance is None:
        settings = get_settings()
        factory = _PROVIDERS.get(settings.llm_provider)
        if factory is None:
            raise ValueError(
                f"Unknown LLM provider {settings.llm_provider!r}. "
                f"Known providers: {', '.join(sorted(_PROVIDERS))}."
            )
        _instance = factory()
    return _instance


async def close_llm() -> None:
    global _instance
    if _instance is not None:
        await _instance.aclose()
        _instance = None


__all__ = [
    "GenerationResult",
    "LLMProvider",
    "LLMUnavailable",
    "Message",
    "ModelInfo",
    "OllamaProvider",
    "close_llm",
    "extract_json",
    "get_llm",
    "register_provider",
    "wrap_untrusted",
]
