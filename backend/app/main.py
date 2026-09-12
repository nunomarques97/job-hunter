"""Job Hunter API.

The backend runs as a local process bound to the loopback interface and is
reached only by the desktop shell. It is not a public server and is not exposed
on the network.
"""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from .core.config import get_settings
from .core.startup import EXIT_REFUSED, StartupRefusal, report

# Read before anything else in this package is imported.
#
# Every other module here reaches the configuration eventually: the session
# module builds the engine at import time, and building it creates the data
# directory. So a setting this application refuses to trust has to be caught
# above those imports, or the first thing a wrong path does is create a folder
# somewhere nobody asked for — and the failure arrives as an import traceback
# rather than as a sentence. This is the one place in the package where the
# import order is load-bearing.
try:
    settings = get_settings()
except StartupRefusal as refusal:
    report(refusal)
    raise SystemExit(EXIT_REFUSED) from None

from fastapi import FastAPI, Request  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402
from fastapi.responses import JSONResponse  # noqa: E402

from .api import api_router  # noqa: E402
from .core.logging import configure_logging, log_slow_requests  # noqa: E402
from .db import init_db  # noqa: E402
from .llm import close_llm  # noqa: E402

configure_logging()
logger = logging.getLogger("job_hunter")


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info(
        "starting %s %s on %s:%s", settings.app_name, settings.version, settings.host, settings.port
    )
    init_db()
    logger.info("database ready at %s", settings.data_dir)
    yield
    logger.info("shutting down")
    await close_llm()
    logger.info("shutdown complete")


app = FastAPI(
    title="Job Hunter API",
    version=settings.version,
    description="Local backend for the Job Hunter desktop application.",
    lifespan=lifespan,
)

app.middleware("http")(log_slow_requests)

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
