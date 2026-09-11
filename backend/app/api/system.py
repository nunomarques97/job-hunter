"""Health, system information, and the report the diagnostic panel copies."""
from __future__ import annotations

import platform
import sys
from pathlib import Path

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import inspect, select, text
from sqlalchemy.orm import Session

from ..core.config import LLM_STAGES, get_settings
from ..core.logging import current_log_path, log_dir, redact_text
from ..db import engine as db_engine, get_db
from ..llm import get_llm
from ..models.job import Job
from ..sources import available_sources

router = APIRouter()

#: What ``/api/health`` answers under ``service``, and nothing else does.
#:
#: The desktop shell has to be able to tell this backend apart from any other
#: program that happens to hold the port. A 200 proves only that something
#: speaks HTTP, so the shell requires this exact value before it will treat a
#: listener as the Job Hunter API. It is a literal rather than ``app_name``
#: because the handshake must not change when the product is renamed.
#: ``src-tauri/src/backend.rs`` holds the other half.
SERVICE_IDENTITY = "job-hunter"


@router.get("/health")
async def health(db: Session = Depends(get_db)) -> dict:
    """Overall readiness.

    The application is usable without the model, so a missing model is
    ``degraded`` rather than ``unhealthy``. Only a database it cannot read makes
    it unhealthy.
    """
    settings = get_settings()

    database = {"status": "healthy", "detail": ""}
    try:
        db.execute(text("SELECT 1"))
        tables = inspect(db_engine).get_table_names()
        database["tables"] = len(tables)
        if not tables:
            database = {"status": "unhealthy", "detail": "The database has no tables."}
    except Exception as exc:  # noqa: BLE001
        database = {"status": "unhealthy", "detail": str(exc)}

    llm_info = await get_llm().info()
    llm = {
        "status": "healthy" if llm_info.available else "degraded",
        "provider": llm_info.provider,
        "model": llm_info.model,
        "detail": llm_info.detail,
    }

    if database["status"] == "unhealthy":
        overall = "unhealthy"
    elif llm["status"] != "healthy":
        overall = "degraded"
    else:
        overall = "healthy"

    return {
        "service": SERVICE_IDENTITY,
        "status": overall,
        "version": settings.version,
        "database": database,
        "llm": llm,
    }


def file_facts(path: Path | None) -> dict:
    """Whether a file is there, and how big it is.

    Reported rather than assumed. A database path naming a file that does not
    exist, and a log file nothing has written to, are both ordinary states the
    panel has to be able to show as what they are.
    """
    if path is None:
        return {"path": "", "exists": False, "size_bytes": 0}
    try:
        stat = path.stat()
    except OSError:
        return {"path": str(path), "exists": False, "size_bytes": 0}
    return {"path": str(path), "exists": True, "size_bytes": stat.st_size}


def database_file(url: str) -> Path | None:
    """The file a SQLite URL points at, or ``None`` for anything else."""
    prefix = "sqlite:///"
    if not url.startswith(prefix):
        return None
    raw = url[len(prefix) :]
    if not raw:
        return None
    path = Path(raw)
    # A relative URL resolves against the working directory, which is the
    # defect TASK 008 owns. It is reported as it actually resolves, so a
    # database somewhere unexpected is visible rather than quietly corrected.
    return path if path.is_absolute() else (Path.cwd() / path).resolve()


async def model_status() -> dict:
    """The model runtime, the models it holds, and what each stage will use.

    One boolean is useless here, because the fix depends on which of two
    failures happened: a runtime that is not running, or a running runtime that
    does not have the configured tag. Only the second has a one-line fix, and
    this returns the command for it.
    """
    settings = get_settings()
    provider = get_llm()
    runtime = await provider.status()
    installed = set(runtime.installed)

    stages = []
    for stage, label in LLM_STAGES:
        model = settings.model_for(stage)
        # Nothing can be claimed about a tag when the runtime never answered,
        # so the answer is null rather than false.
        present = model in installed if runtime.reachable else None
        stages.append(
            {
                "stage": stage,
                "label": label,
                "model": model,
                "pinned": stage in settings.stage_models,
                "installed": present,
                "pull_command": provider.install_command(model),
            }
        )

    missing = sorted({entry["model"] for entry in stages if entry["installed"] is False})
    return {
        "provider": runtime.provider,
        "base_url": runtime.base_url,
        "endpoint": runtime.endpoint,
        "reachable": runtime.reachable,
        "detail": runtime.detail,
        "default_model": settings.ollama_model,
        "num_ctx": settings.ollama_num_ctx,
        "installed_models": runtime.installed,
        "stages": stages,
        "missing_models": missing,
        "pull_commands": [provider.install_command(model) for model in missing],
    }


@router.get("/info")
async def info(db: Session = Depends(get_db)) -> dict:
    """Everything the backend knows about where and how it is running.

    This is what the diagnostic panel renders. Every value is read at runtime;
    no path, name or machine detail is written down in this repository.
    """
    settings = get_settings()
    url = settings.resolved_database_url
    database = file_facts(database_file(url))
    database["url"] = url.replace(str(settings.data_dir), "<data>")

    return {
        "app_name": settings.app_name,
        "version": settings.version,
        "python": sys.version.split()[0],
        "python_executable": sys.executable,
        "platform": f"{platform.system()} {platform.release()}",
        "data_dir": str(settings.data_dir),
        "port": settings.port,
        "database": database,
        "logs": {"dir": str(log_dir()), **file_facts(current_log_path())},
        "llm": await model_status(),
        # Also kept flat, because other screens already read these two and a
        # rename is not what this change is for.
        "llm_provider": settings.llm_provider,
        "llm_model": settings.ollama_model,
        "sources": available_sources(),
        "jobs_stored": db.scalar(select(Job.id).limit(1)) is not None,
    }


class DiagnosticsRequest(BaseModel):
    """What the panel posts in, because the backend cannot see it.

    The desktop shell owns the process, the port it settled on and the paths it
    resolved; the backend has no view of any of that. The panel sends those
    lines here so one report carries both halves — and so both halves leave
    through the same redaction filter.
    """

    shell: list[str] = Field(default_factory=list, max_length=60)
    log: list[str] = Field(default_factory=list, max_length=200)


def _section(title: str, lines: list[str]) -> list[str]:
    return ["", title, "-" * len(title), *lines]


async def diagnostics_report(request: DiagnosticsRequest) -> str:
    """The plain text the panel puts on the clipboard.

    Every line leaves through :func:`redact_text`, the filter the log writes
    through. Invariant 5 is about credentials leaving the application, not only
    about credentials reaching the database, and a clipboard is a way out like
    any other. It is applied per line rather than to the whole report because
    the filter also caps a line's length, and one cap over the whole document
    would throw the report away after four hundred characters.
    """
    settings = get_settings()
    url = settings.resolved_database_url
    database = file_facts(database_file(url))
    logs = file_facts(current_log_path())

    lines: list[str] = [f"{settings.app_name} {settings.version} — diagnostics"]

    if request.shell:
        lines += _section("Desktop shell", list(request.shell))

    lines += _section(
        "Backend",
        [
            f"python            {sys.version.split()[0]} at {sys.executable}",
            f"platform          {platform.system()} {platform.release()}",
            f"configured port   {settings.port}",
            f"data directory    {settings.data_dir}",
            f"database          {database['path'] or url}",
            f"database file     {'present' if database['exists'] else 'missing'}"
            f", {database['size_bytes']} bytes",
            f"log directory     {log_dir()}",
            f"log file          {logs['path']}",
            f"log file state    {'present' if logs['exists'] else 'missing'}"
            f", {logs['size_bytes']} bytes",
        ],
    )

    models = await model_status()
    model_lines = [
        f"provider          {models['provider']} at {models['base_url']}",
        f"reachable         {'yes' if models['reachable'] else 'no'} — {models['detail']}",
        f"context window    {models['num_ctx']}",
    ]
    for entry in models["stages"]:
        state = (
            "unknown, the runtime did not answer"
            if entry["installed"] is None
            else ("installed" if entry["installed"] else "NOT INSTALLED")
        )
        pinned = " (pinned)" if entry["pinned"] else ""
        model_lines.append(f"{entry['stage']:<17} {entry['model']}{pinned} — {state}")
    model_lines.append("installed         " + (", ".join(models["installed_models"]) or "none"))
    for command in models["pull_commands"]:
        model_lines.append(f"fix               {command}")
    lines += _section("Model", model_lines)

    if request.log:
        lines += _section("Log tail", list(request.log))

    return "\n".join(redact_text(line) for line in lines)


@router.post("/diagnostics")
async def diagnostics(request: DiagnosticsRequest) -> dict:
    """Assemble the diagnostic report and hand it back as text to copy."""
    return {"text": await diagnostics_report(request)}
