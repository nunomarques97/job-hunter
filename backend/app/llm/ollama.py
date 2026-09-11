"""Ollama provider, speaking the native /api/chat endpoint."""
from __future__ import annotations

import time
from typing import Any

import httpx

from ..core.config import get_settings
from .base import GenerationResult, LLMProvider, LLMUnavailable, ModelInfo, extract_json


class OllamaProvider(LLMProvider):
    def __init__(
        self,
        base_url: str | None = None,
        model: str | None = None,
        timeout: float | None = None,
    ) -> None:
        settings = get_settings()
        self.base_url = (base_url or settings.ollama_base_url).rstrip("/")
        self.model = model or settings.ollama_model
        self.timeout = timeout or settings.llm_timeout_seconds
        self._client: httpx.AsyncClient | None = None

    def _http(self) -> httpx.AsyncClient:
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(
                base_url=self.base_url,
                timeout=httpx.Timeout(self.timeout, connect=5.0),
            )
        return self._client

    async def aclose(self) -> None:
        if self._client is not None and not self._client.is_closed:
            await self._client.aclose()

    async def _chat(
        self,
        system: str,
        user: str,
        *,
        temperature: float,
        json_mode: bool,
        max_tokens: int | None = None,
    ) -> GenerationResult:
        options: dict[str, Any] = {"temperature": temperature}
        if max_tokens:
            options["num_predict"] = max_tokens
        payload: dict[str, Any] = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            "stream": False,
            "options": options,
        }
        if json_mode:
            payload["format"] = "json"

        started = time.perf_counter()
        try:
            response = await self._http().post("/api/chat", json=payload)
            response.raise_for_status()
            data = response.json()
        except httpx.HTTPStatusError as exc:
            raise LLMUnavailable(
                f"Ollama returned {exc.response.status_code} for model {self.model}."
            ) from exc
        except httpx.HTTPError as exc:
            raise LLMUnavailable(f"Could not reach Ollama at {self.base_url}: {exc}") from exc

        text = (data.get("message") or {}).get("content", "")
        if not text.strip():
            raise LLMUnavailable("Ollama returned an empty message.")
        return GenerationResult(
            text=text,
            model=self.model,
            seconds=round(time.perf_counter() - started, 3),
            meta={"eval_count": data.get("eval_count")},
        )

    async def complete(
        self,
        system: str,
        user: str,
        *,
        temperature: float = 0.2,
        max_tokens: int | None = None,
    ) -> GenerationResult:
        return await self._chat(
            system, user, temperature=temperature, json_mode=False, max_tokens=max_tokens
        )

    async def complete_json(self, system: str, user: str, *, temperature: float = 0.1) -> Any:
        result = await self._chat(system, user, temperature=temperature, json_mode=True)
        return extract_json(result.text)

    async def info(self) -> ModelInfo:
        endpoint = f"{self.base_url}/api/tags"
        try:
            response = await self._http().get("/api/tags", timeout=5.0)
            response.raise_for_status()
            names = [item.get("name", "") for item in response.json().get("models", [])]
        except httpx.HTTPError as exc:
            return ModelInfo(
                provider="ollama",
                model=self.model,
                endpoint=endpoint,
                available=False,
                detail=f"Ollama is not reachable at {self.base_url}.",
            )
        if self.model not in names:
            return ModelInfo(
                provider="ollama",
                model=self.model,
                endpoint=endpoint,
                available=False,
                detail=(
                    f"Ollama is running but {self.model} is not pulled. "
                    f"Available: {', '.join(names[:6]) or 'none'}."
                ),
            )
        return ModelInfo(
            provider="ollama",
            model=self.model,
            endpoint=endpoint,
            available=True,
            detail="Ready.",
        )
