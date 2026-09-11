"""Health and system information."""
from __future__ import annotations

import platform
import sys

from fastapi import APIRouter, Depends
from sqlalchemy import inspect, select, text
from sqlalchemy.orm import Session

from ..core.config import get_settings
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


@router.get("/info")
async def info(db: Session = Depends(get_db)) -> dict:
    settings = get_settings()
    return {
        "app_name": settings.app_name,
        "version": settings.version,
        "python": sys.version.split()[0],
        "platform": f"{platform.system()} {platform.release()}",
        "data_dir": str(settings.data_dir),
        "database": settings.resolved_database_url.replace(str(settings.data_dir), "<data>"),
        "llm_provider": settings.llm_provider,
        "llm_model": settings.ollama_model,
        "sources": available_sources(),
        "jobs_stored": db.scalar(select(Job.id).limit(1)) is not None,
    }
