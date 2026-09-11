"""Job Hunter API.

The backend runs as a local process bound to the loopback interface and is
reached only by the desktop shell. It is not a public server and is not exposed
on the network.
"""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .api import api_router
from .core.config import get_settings
from .db import init_db
from .llm import close_llm

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-8s %(name)s  %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("job_hunter")

settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    logger.info("Database ready at %s", settings.data_dir)
    yield
    await close_llm()


app = FastAPI(
    title="Job Hunter API",
    version=settings.version,
    description="Local backend for the Job Hunter desktop application.",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(Exception)
async def unhandled_exception(request: Request, exc: Exception) -> JSONResponse:
    """Return a sentence the interface can show, and log the detail here.

    A stack trace in the interface is noise to the user and a leak of paths, so
    it stays in the log.
    """
    logger.exception("Unhandled error on %s %s", request.method, request.url.path)
    return JSONResponse(
        status_code=500,
        content={
            "detail": "Something went wrong on the local backend. The Activity log has the detail."
        },
    )


app.include_router(api_router)


@app.get("/")
async def root() -> dict:
    return {
        "name": settings.app_name,
        "version": settings.version,
        "docs": "/docs",
        "api": "/api",
    }


def run() -> None:
    """Entry point used by the desktop shell and by ``python -m app.main``."""
    import uvicorn

    uvicorn.run(
        "app.main:app",
        host=settings.host,
        port=settings.port,
        reload=settings.debug,
        log_level="info",
    )


if __name__ == "__main__":
    run()
