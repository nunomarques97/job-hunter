"""Automation control: start, pause, resume, stop, run now, emergency stop."""
from __future__ import annotations

import asyncio

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..db import get_db, session_scope
from ..models.automation import AutomationRun
from ..models.candidate import Candidate
from ..models.enums import RUN_STAGE_ORDER
from ..schemas.application import (
    AutomationConfigRead,
    AutomationConfigUpdate,
    AutomationRunRead,
    AutomationState,
)
from ..schemas.common import Message, Page
from ..services.automation import RunCancelled, engine, get_config
from .deps import get_candidate

router = APIRouter()


def _state(db: Session) -> AutomationState:
    config = get_config(db)
    current = None
    if engine.current_run_id is not None:
        run = db.get(AutomationRun, engine.current_run_id)
        current = AutomationRunRead.model_validate(run) if run else None
    return AutomationState(
        is_running=engine.is_running,
        is_paused=engine.is_paused,
        current_run=current,
        config=AutomationConfigRead.model_validate(config),
        blocking_reason=config.blocking_reason(),
    )


@router.get("/state", response_model=AutomationState)
async def get_state(db: Session = Depends(get_db)) -> AutomationState:
    return _state(db)


@router.get("/stages")
async def get_stages() -> list[str]:
    """The pipeline stages, in order, for the progress strip."""
    return RUN_STAGE_ORDER


@router.get("/config", response_model=AutomationConfigRead)
async def read_config(db: Session = Depends(get_db)) -> AutomationConfigRead:
    return AutomationConfigRead.model_validate(get_config(db))


@router.put("/config", response_model=AutomationConfigRead)
async def update_config(
    update: AutomationConfigUpdate, db: Session = Depends(get_db)
) -> AutomationConfigRead:
    config = get_config(db)
    for field, value in update.model_dump(exclude_unset=True).items():
        setattr(config, field, value)
    db.flush()
    return AutomationConfigRead.model_validate(config)


async def _run_in_background(candidate_id: int) -> None:
    """Own a fresh session for the run.

    The request's session closes when the response is sent, so a background run
    that borrowed it would fail on its first query.
    """
    db = session_scope()
    try:
        candidate = db.get(Candidate, candidate_id)
        if candidate is None:
            return
        await engine.run(db, candidate, trigger="manual")
    finally:
        db.close()


@router.post("/run", response_model=AutomationState)
async def run_now(
    db: Session = Depends(get_db),
    candidate: Candidate = Depends(get_candidate),
) -> AutomationState:
    """Start one full pipeline run immediately."""
    if engine.is_running:
        raise HTTPException(status_code=409, detail="A run is already in progress.")
    config = get_config(db)
    if config.emergency_stop:
        raise HTTPException(
            status_code=409,
            detail="Emergency stop is engaged. Release it in Automation before running.",
        )
    db.commit()

    engine._task = asyncio.create_task(_run_in_background(candidate.id))  # noqa: SLF001
    await asyncio.sleep(0)
    return _state(db)


@router.post("/start", response_model=AutomationState)
async def start(db: Session = Depends(get_db)) -> AutomationState:
    """Enable scheduled automation."""
    config = get_config(db)
    if config.emergency_stop:
        raise HTTPException(status_code=409, detail="Release the emergency stop first.")
    config.enabled = True
    db.flush()
    return _state(db)


@router.post("/pause", response_model=AutomationState)
async def pause(db: Session = Depends(get_db)) -> AutomationState:
    """Hold the current run between stages. Nothing in flight is lost."""
    engine.pause()
    return _state(db)


@router.post("/resume", response_model=AutomationState)
async def resume(db: Session = Depends(get_db)) -> AutomationState:
    engine.resume()
    return _state(db)


@router.post("/stop", response_model=AutomationState)
async def stop(db: Session = Depends(get_db)) -> AutomationState:
    """Stop the current run and disable scheduled automation."""
    engine.stop()
    config = get_config(db)
    config.enabled = False
    db.flush()
    return _state(db)


@router.post("/emergency-stop", response_model=AutomationState)
async def emergency_stop(engage: bool = True, db: Session = Depends(get_db)) -> AutomationState:
    """The hard stop.

    While engaged, no run starts and a run in flight halts at its next stage
    boundary. It overrides every other setting and must be released explicitly.
    """
    config = get_config(db)
    config.emergency_stop = engage
    if engage:
        config.enabled = False
        engine.stop()
    db.flush()
    return _state(db)


@router.get("/runs", response_model=Page[AutomationRunRead])
async def list_runs(
    page: int = 1, page_size: int = 25, db: Session = Depends(get_db)
) -> Page[AutomationRunRead]:
    total = db.scalar(select(func.count(AutomationRun.id))) or 0
    rows = db.scalars(
        select(AutomationRun)
        .order_by(AutomationRun.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()
    return Page[AutomationRunRead](
        items=[AutomationRunRead.model_validate(row) for row in rows],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get("/runs/{run_id}", response_model=AutomationRunRead)
async def get_run(run_id: int, db: Session = Depends(get_db)) -> AutomationRunRead:
    run = db.get(AutomationRun, run_id)
    if run is None:
        raise HTTPException(status_code=404, detail="That run does not exist.")
    return AutomationRunRead.model_validate(run)
