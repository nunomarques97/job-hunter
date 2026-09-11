"""Structured logging, and the guarantee about what never reaches the log.

The desktop shell pipes this process's stdout and stderr into
``%LOCALAPPDATA%\\JobHunter\\logs\\backend-YYYY-MM-DD.log`` and owns that file,
its rotation and how many are kept. The backend writes to the stream. One
writer per file, and ``npm run backend`` still prints to the terminal.

Times are UTC with a trailing ``Z``, matching the lines the shell writes, so a
single file never mixes two clocks.

Every record passes through :class:`Redactor`. Its guarantee is narrow and
absolute: a credential, a password and a document body do not reach the log,
whatever a caller passes in. It works on the formatted message rather than on
the call site, so a new log line somewhere else in the codebase cannot opt out
of it by accident.
"""
from __future__ import annotations

import logging
import re
import sys
import time
from typing import Any, Awaitable, Callable

# Anything whose name looks like this has its value masked, wherever it appears.
SECRET_NAMES = (
    "password",
    "passwd",
    "secret",
    "token",
    "api_key",
    "apikey",
    "authorization",
    "auth",
    "credential",
    "credentials",
    "cookie",
    "session",
    "private_key",
    "access_key",
    "client_secret",
)

MASK = "***"

# The longest a single log message may be. A CV, a cover letter and a job
# description are all far longer than this, so a body cannot be logged whole
# even by a caller who meant to. Tracebacks are unaffected: they travel in
# exc_info and are formatted separately.
MAX_MESSAGE = 400

# The value runs to the end of the field rather than to the next space. A
# header reads `Authorization: Bearer <token>`, and stopping at the first space
# would mask the word "Bearer" and print the token.
_ASSIGNMENT = re.compile(
    r"(?i)(['\"]?\b(?:" + "|".join(SECRET_NAMES) + r")\b['\"]?\s*[=:]\s*)"
    r"('[^']*'|\"[^\"]*\"|[^,;\n}\]]+)"
)

_SCHEME = re.compile(r"(?i)\b(bearer|basic|token)\s+[A-Za-z0-9._\-+/=]{4,}")

# A password carried inside a URL, which no other rule would catch.
_URL_CREDENTIALS = re.compile(r"(?i)\b([a-z][a-z0-9+.\-]*://)([^/\s:@]+):([^/\s@]+)@")


def redact_text(text: str) -> str:
    """Return ``text`` with secrets masked and anything long cut short."""
    cleaned = _ASSIGNMENT.sub(lambda match: f"{match.group(1)}{MASK}", text)
    cleaned = _SCHEME.sub(lambda match: f"{match.group(1)} {MASK}", cleaned)
    cleaned = _URL_CREDENTIALS.sub(lambda match: f"{match.group(1)}{match.group(2)}:{MASK}@", cleaned)
    if len(cleaned) > MAX_MESSAGE:
        dropped = len(cleaned) - MAX_MESSAGE
        cleaned = f"{cleaned[:MAX_MESSAGE]} [truncated, {dropped} more characters]"
    return cleaned


class Redactor(logging.Filter):
    """Rewrite every record's message before any handler can emit it."""

    def filter(self, record: logging.LogRecord) -> bool:
        try:
            message = record.getMessage()
        except Exception:  # a bad format string is not worth losing the line for
            message = str(record.msg)
        record.msg = redact_text(message)
        record.args = ()
        return True


class DropHealthPolls(logging.Filter):
    """Keep successful health checks out of the access log.

    The window polls ``/api/health`` for as long as it is open, so leaving
    those lines in buries every real event under thousands of identical ones. A
    health check that does not return 2xx is an event and is kept.
    """

    def filter(self, record: logging.LogRecord) -> bool:
        try:
            message = record.getMessage()
        except Exception:
            return True
        if "/api/health" not in message:
            return True
        return not (' 200' in message or ' 204' in message)


class UtcFormatter(logging.Formatter):
    converter = time.gmtime
    default_time_format = "%Y-%m-%d %H:%M:%S"

    def formatTime(self, record: logging.LogRecord, datefmt: str | None = None) -> str:
        return f"{super().formatTime(record, datefmt or self.default_time_format)}Z"


_configured = False


def configure_logging(level: int = logging.INFO) -> None:
    """Install the handler, the format and the redaction filter.

    Safe to call more than once: uvicorn's reloader imports the application
    again in the child process.
    """
    global _configured
    if _configured:
        return

    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(UtcFormatter("%(asctime)s %(levelname)-8s %(name)-22s %(message)s"))
    handler.addFilter(Redactor())

    root = logging.getLogger()
    for existing in list(root.handlers):
        root.removeHandler(existing)
    root.addHandler(handler)
    root.setLevel(level)

    # uvicorn installs its own handlers, which would bypass the filter and
    # print a second copy of every line.
    for name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
        uvicorn_logger = logging.getLogger(name)
        uvicorn_logger.handlers = []
        uvicorn_logger.propagate = True
    logging.getLogger("uvicorn.access").addFilter(DropHealthPolls())

    # httpx logs a line for every outbound request, including one per health
    # check to the model runtime. The interesting ones are logged by name where
    # they are made.
    logging.getLogger("httpx").setLevel(logging.WARNING)

    _configured = True


logger = logging.getLogger("job_hunter")

# How slow a request has to be before it is worth a line of its own.
SLOW_REQUEST_SECONDS = 1.0


async def log_slow_requests(request: Any, call_next: Callable[[Any], Awaitable[Any]]) -> Any:
    """Middleware: record any request that took longer than a second.

    The path and the method are logged, never the query string or the body,
    because both carry user content.
    """
    started = time.perf_counter()
    try:
        response = await call_next(request)
    except Exception:
        # Deliberately not logged here. The application's own handler for
        # unhandled exceptions records the method, the path and the traceback,
        # and a second copy of a fifty-line traceback helps nobody find it.
        raise
    elapsed = time.perf_counter() - started
    if elapsed >= SLOW_REQUEST_SECONDS:
        logger.warning(
            "%s %s took %.2fs (status %s)",
            request.method,
            request.url.path,
            elapsed,
            response.status_code,
        )
    return response


def log_llm_call(operation: str, model: str, seconds: float, outcome: str, detail: str = "") -> None:
    """One line per model call: what it was for, how long, and how it ended.

    Prompts and completions are never logged. They contain the job description
    and the candidate's own history, and the point of the line is the timing.
    """
    message = "llm %s model=%s %.2fs %s" % (operation, model, seconds, outcome)
    if detail:
        message = f"{message}: {detail}"
    if outcome == "ok":
        logger.info(message)
    else:
        logger.warning(message)
