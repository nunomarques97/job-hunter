"""Application configuration.

Values come from the environment with the ``JOB_HUNTER_`` prefix. Secrets are
never persisted to the database and never written to a log line; anything that
carries one goes through :func:`redact` first.
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

from .startup import StartupRefusal


def _env(name: str, default: str) -> str:
    return os.getenv(f"JOB_HUNTER_{name}", default)


def _env_float(name: str, default: float) -> float:
    try:
        return float(_env(name, str(default)))
    except ValueError:
        return default


def _env_int(name: str, default: int) -> int:
    try:
        return int(_env(name, str(default)))
    except ValueError:
        return default


def _env_bool(name: str, default: bool) -> bool:
    return _env(name, "1" if default else "0").strip().lower() in {"1", "true", "yes", "on"}


#: The prefix a SQLite URL uses for a file on disk.
_SQLITE_FILE_PREFIX = "sqlite:///"

#: SQLite URLs that name no file at all. Neither can be relative to anything,
#: so neither is checked against the working directory.
_SQLITE_MEMORY_URLS = {"sqlite://", "sqlite:///:memory:"}


def _refuse_relative(variable: str, value: str, resolves_to: Path) -> StartupRefusal:
    """The refusal both path variables raise.

    Worded once because the two variables fail for exactly the same reason and
    a person fixing one has to do the same thing to the other.
    """
    return StartupRefusal(
        kind="relative_path_setting",
        summary=(
            f"{variable} is set to a relative path, and a relative path means a different "
            f"place every time the application is started from a different folder."
        ),
        remedy=f"Set {variable} to a full path beginning with a drive letter, or unset it.",
        probed=[
            f"{variable} = {value}",
            f"from this working directory it would mean {resolves_to}",
        ],
    )


def resolve_data_dir(override: str | None, *, cwd: Path | None = None) -> Path | None:
    """The data directory an override names, or ``None`` when there is none.

    A relative value is refused rather than resolved. It was silently resolved
    against the working directory until this check existed, which is how a
    second database came to sit inside a build output directory: the same
    setting meant one place when the shell launched the backend and another
    when a terminal did.
    """
    if override is None or not override.strip():
        return None
    path = Path(override).expanduser()
    if not path.is_absolute():
        here = cwd if cwd is not None else Path.cwd()
        raise _refuse_relative("JOB_HUNTER_DATA_DIR", override, (here / path).resolve())
    return path


def resolve_database_url(override: str | None, *, cwd: Path | None = None) -> str:
    """The database URL an override names, or ``""`` when there is none.

    Only a SQLite URL naming a file is checked: an in-memory database and a
    server URL have no path that the working directory could move.
    """
    if override is None or not override.strip():
        return ""
    url = override.strip()
    if url in _SQLITE_MEMORY_URLS or not url.startswith(_SQLITE_FILE_PREFIX):
        return url
    raw = url[len(_SQLITE_FILE_PREFIX) :]
    if not raw or raw == ":memory:":
        return url
    path = Path(raw).expanduser()
    if not path.is_absolute():
        here = cwd if cwd is not None else Path.cwd()
        raise _refuse_relative("JOB_HUNTER_DATABASE_URL", override, (here / path).resolve())
    return url


def default_data_dir() -> Path:
    """Per-user writable data directory.

    A packaged desktop app cannot write next to its executable, so application
    data lives under the operating system's application-data directory.
    """
    override = resolve_data_dir(os.getenv("JOB_HUNTER_DATA_DIR"))
    if override is not None:
        return override
    if os.name == "nt":
        base = os.getenv("LOCALAPPDATA") or os.path.expanduser("~")
        return Path(base) / "JobHunter"
    return Path(os.path.expanduser("~")) / ".local" / "share" / "job-hunter"


#: The stages that call the model, in the order the diagnostic panel lists
#: them, each with the sentence a person reads. Every stage here is a real call
#: site: nothing is listed that the code does not actually run.
LLM_STAGES: tuple[tuple[str, str], ...] = (
    ("scoring", "Scoring a posting"),
    ("tailor_cv", "Tailoring the CV"),
    ("cover_letter", "Writing a cover letter"),
    ("cv_import", "Reading an uploaded CV"),
)


def _stage_models() -> dict[str, str]:
    """Stage pins from the environment, holding only the ones that were set."""
    pinned: dict[str, str] = {}
    for stage, _ in LLM_STAGES:
        value = _env(f"OLLAMA_MODEL_{stage.upper()}", "").strip()
        if value:
            pinned[stage] = value
    return pinned


@dataclass(frozen=True)
class Settings:
    app_name: str = "Job Hunter"
    version: str = "0.2.0"
    host: str = field(default_factory=lambda: _env("HOST", "127.0.0.1"))
    port: int = field(default_factory=lambda: _env_int("PORT", 8756))
    debug: bool = field(default_factory=lambda: _env_bool("DEBUG", False))

    data_dir: Path = field(default_factory=default_data_dir)
    database_url: str = field(
        default_factory=lambda: resolve_database_url(os.getenv("JOB_HUNTER_DATABASE_URL"))
    )

    llm_provider: str = field(default_factory=lambda: _env("LLM_PROVIDER", "ollama"))
    ollama_base_url: str = field(default_factory=lambda: _env("OLLAMA_BASE_URL", "http://127.0.0.1:11434"))
    #: A stock instruct tag, pulled with one documented command and nothing
    #: else. The first default was ``qwen3-coder:30b-32k``, a tag no stock
    #: Ollama install has: it existed only if the user ran ``ollama create``
    #: over the repository's ``Modelfile``, which nothing told them to do. The
    #: second was ``qwen3:8b``, chosen for throughput — but scoring runs over a
    #: cached shortlist rather than every posting, so throughput was never the
    #: binding constraint, and 8b was not installed on the one machine that
    #: runs this while 14b was. Blueprint OD-3. Override with
    #: ``JOB_HUNTER_OLLAMA_MODEL``, or per stage with
    #: ``JOB_HUNTER_OLLAMA_MODEL_<STAGE>``.
    ollama_model: str = field(default_factory=lambda: _env("OLLAMA_MODEL", "qwen3:14b"))
    #: Per-stage pins, holding only the stages that were actually overridden.
    #: A 30B can be put on ``cover_letter`` and ``tailor_cv`` while scoring
    #: stays on the default, which is the arrangement OD-3 describes.
    stage_models: dict[str, str] = field(default_factory=lambda: _stage_models())
    #: Context window, sent with every request. It used to come from a
    #: ``PARAMETER num_ctx`` baked into a tag the user had to build by hand, so
    #: a stock tag silently ran at Ollama's much smaller default.
    ollama_num_ctx: int = field(default_factory=lambda: _env_int("OLLAMA_NUM_CTX", 16384))
    llm_timeout_seconds: float = field(default_factory=lambda: _env_float("LLM_TIMEOUT", 180.0))
    llm_enabled: bool = field(default_factory=lambda: _env_bool("LLM_ENABLED", True))

    http_timeout_seconds: float = field(default_factory=lambda: _env_float("HTTP_TIMEOUT", 25.0))
    user_agent: str = field(
        default_factory=lambda: _env("USER_AGENT", "JobHunter/0.2 (+local desktop application)")
    )
    discovery_max_per_source: int = field(default_factory=lambda: _env_int("DISCOVERY_MAX_PER_SOURCE", 120))

    default_daily_application_limit: int = field(default_factory=lambda: _env_int("DAILY_LIMIT", 25))
    default_min_score: float = field(default_factory=lambda: _env_float("MIN_SCORE", 70.0))

    def model_for(self, stage: str | None = None) -> str:
        """The model tag a stage runs on.

        An unpinned stage runs on the default, and an unknown stage name is
        treated as unpinned rather than as an error: the caller is asking which
        model to use, not asserting that a stage exists.
        """
        if not stage:
            return self.ollama_model
        return self.stage_models.get(stage) or self.ollama_model

    @property
    def resolved_database_url(self) -> str:
        if self.database_url:
            return self.database_url
        self.data_dir.mkdir(parents=True, exist_ok=True)
        return f"sqlite:///{(self.data_dir / 'job_hunter.db').as_posix()}"

    @property
    def documents_dir(self) -> Path:
        path = self.data_dir / "documents"
        path.mkdir(parents=True, exist_ok=True)
        return path

    @property
    def cors_origins(self) -> list[str]:
        return [
            "http://localhost:5173",
            "http://127.0.0.1:5173",
            "http://localhost:1420",
            "http://127.0.0.1:1420",
            "tauri://localhost",
            "http://tauri.localhost",
        ]


@lru_cache
def get_settings() -> Settings:
    return Settings()


_SECRET_HINTS = ("password", "secret", "token", "key", "authorization", "credential", "cookie")


def redact(mapping: dict) -> dict:
    """Return a copy of ``mapping`` with anything secret-looking masked."""
    return {
        key: ("***" if any(hint in key.lower() for hint in _SECRET_HINTS) else value)
        for key, value in mapping.items()
    }
