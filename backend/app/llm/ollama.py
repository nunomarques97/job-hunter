"""Ollama provider, speaking the native /api/chat endpoint."""
from __future__ import annotations

import time
from typing import Any

import httpx

from ..core.config import get_settings
from ..core.logging import log_llm_call
from .base import (
    GenerationResult,
    LLMProvider,
    LLMUnavailable,
    ModelInfo,
    ProviderStatus,
    extract_json,
)


class OllamaProvider(LLMProvider):
    def __init__(
        self,
        base_url: str | None = None,
        model: str | None = None,
        timeout: float | None = None,
        num_ctx: int | None = None,
    ) -> None:
        settings = get_settings()
        self.base_url = (base_url or settings.ollama_base_url).rstrip("/")
        self.model = model or settings.ollama_model
        self.timeout = timeout or settings.llm_timeout_seconds
        self.num_ctx = num_ctx or settings.ollama_num_ctx
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
        # The context window travels with the request. It used to live in a
        # ``PARAMETER num_ctx`` inside a Modelfile the user had to run
        # ``ollama create`` over, which meant a stock tag quietly ran at
        # Ollama's default window and long job descriptions were truncated
        # without anything saying so.
        options: dict[str, Any] = {"temperature": temperature, "num_ctx": self.num_ctx}
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

        operation = "chat_json" if json_mode else "chat"
        started = time.perf_counter()
        try:
            response = await self._http().post("/api/chat", json=payload)
            response.raise_for_status()
            data = response.json()
        except httpx.HTTPStatusError as exc:
            log_llm_call(
                operation,
                self.model,
                time.perf_counter() - started,
                "http_error",
                str(exc.response.status_code),
            )
            raise LLMUnavailable(
                f"Ollama returned {exc.response.status_code} for model {self.model}."
            ) from exc
        except httpx.HTTPError as exc:
            log_llm_call(
                operation, self.model, time.perf_counter() - started, "unreachable", str(exc)
            )
            raise LLMUnavailable(f"Could not reach Ollama at {self.base_url}: {exc}") from exc

        text = (data.get("message") or {}).get("content", "")
        if not text.strip():
            log_llm_call(operation, self.model, time.perf_counter() - started, "empty")
            raise LLMUnavailable("Ollama returned an empty message.")
        log_llm_call(operation, self.model, time.perf_counter() - started, "ok")
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

    def install_command(self, model: str) -> str:
        return f"ollama pull {model}"

    async def status(self) -> ProviderStatus:
        """Ask Ollama what it has, in one call.

        The tag list is the whole answer: it says the runtime is up, and it says
        which models it holds. Whether any particular tag is configured is a
        question for the caller, not for here.
        """
        endpoint = f"{self.base_url}/api/tags"
        try:
            response = await self._http().get("/api/tags", timeout=5.0)
            response.raise_for_status()
            payload = response.json()
        except (httpx.HTTPError, ValueError) as exc:
            return ProviderStatus(
                provider="ollama",
                base_url=self.base_url,
                endpoint=endpoint,
                reachable=False,
                detail=f"Ollama is not reachable at {self.base_url}: {exc}",
                installed=[],
            )

        models = payload.get("models") if isinstance(payload, dict) else None
        names = sorted(
            str(item.get("name", "")).strip()
            for item in (models or [])
            if isinstance(item, dict) and str(item.get("name", "")).strip()
        )
        return ProviderStatus(
            provider="ollama",
            base_url=self.base_url,
            endpoint=endpoint,
            reachable=True,
            detail=(
                f"Ollama is running with {len(names)} model{'' if len(names) == 1 else 's'} installed."
                if names
                else "Ollama is running but has no models installed."
            ),
            installed=names,
        )

    async def info(self) -> ModelInfo:
        runtime = await self.status()
        if not runtime.reachable:
            return ModelInfo(
                provider="ollama",
                model=self.model,
                endpoint=runtime.endpoint,
                available=False,
                detail=f"Ollama is not reachable at {self.base_url}.",
            )
        if self.model not in runtime.installed:
            return ModelInfo(
                provider="ollama",
                model=self.model,
                endpoint=runtime.endpoint,
                available=False,
                detail=(
                    f"Ollama is running but {self.model} is not pulled. "
                    f"Run `{self.install_command(self.model)}`. "
                    f"Installed: {', '.join(runtime.installed[:6]) or 'none'}."
                ),
            )
        return ModelInfo(
            provider="ollama",
            model=self.model,
            endpoint=runtime.endpoint,
            available=True,
            detail="Ready.",
        )
