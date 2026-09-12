"""Refusals that happen before the application is allowed to serve.

Two things can make this backend refuse to start rather than start badly: a
configured path it cannot trust, and a database migration that did not finish.
Both are the same kind of event — the process has decided it must not serve —
and both have to arrive in front of a person as a sentence rather than as a
traceback.

The desktop shell reads this process's stdout and stderr line by line into the
log file. A refusal is written there twice: once as a marked machine-readable
line the shell parses into its own typed failure, and once as plain sentences
for whoever opens the log or runs the backend from a terminal. The shell half
is ``src-tauri/src/backend.rs``.
"""
from __future__ import annotations

import json
import sys
from dataclasses import dataclass, field

#: The prefix that marks the machine-readable line. Deliberately unlike
#: anything a logger or a traceback emits, because the shell looks for it in a
#: stream that carries both.
MARKER = "JOB-HUNTER-STARTUP-REFUSED "

#: What the process exits with after refusing. 78 is ``EX_CONFIG`` from
#: ``sysexits.h``: the configuration was wrong, not the code.
EXIT_REFUSED = 78


@dataclass(frozen=True)
class StartupRefusal(Exception):
    """A reason this backend will not serve, in the shape an interface needs.

    ``kind`` is for a screen that wants to branch; ``summary`` says what is
    wrong and ``remedy`` says what to do about it. ``probed`` carries the
    values that were looked at, one per line, because a path problem is
    unreadable without the paths.
    """

    kind: str
    summary: str
    remedy: str
    probed: list[str] = field(default_factory=list)

    def __str__(self) -> str:  # pragma: no cover - exercised through report()
        return f"{self.summary} {self.remedy}"

    def as_json(self) -> str:
        return json.dumps(
            {
                "kind": self.kind,
                "summary": self.summary,
                "remedy": self.remedy,
                "probed": list(self.probed),
            },
            ensure_ascii=False,
        )


def report(refusal: StartupRefusal, stream=None) -> None:
    """Write the refusal where both the shell and a person will find it.

    The marked line goes first so that a shell reading a truncated stream still
    gets the typed value. The sentences follow for the log and the terminal.
    """
    out = stream if stream is not None else sys.stderr
    print(MARKER + refusal.as_json(), file=out, flush=True)
    print(f"Job Hunter will not start: {refusal.summary}", file=out, flush=True)
    print(f"What to do: {refusal.remedy}", file=out, flush=True)
    for line in refusal.probed:
        print(f"  {line}", file=out, flush=True)
