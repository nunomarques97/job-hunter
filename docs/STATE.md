# Current state

Where the work actually is. `docs/BLUEPRINT.md` is the plan and `CLAUDE.md` is
the standing rules; neither carries progress. This file does, and updating it
is part of every task's definition of done.

## Completed work units

- **TASK 001b — One-time environment setup.** `scripts/setup.ps1` creates
  `backend/.venv`; `python_command()` probes only interpreters belonging to
  this installation, no `"python"` fallback. *Commit: `000b836`.*
- **TASK 003 + TASK 004 — Show the window first, log everything to disk.**
  The window is created and shown before the backend thread starts.
  Every diagnostic the shell and backend produce goes to one rotated file
  under `%LOCALAPPDATA%\JobHunter\logs`. *Commits: `06ae11c`, `326796b`,
  `5537bdb`.*
- **TASK 006 — Stop adopting a stranger's server.** The shell requires
  `GET /api/health` to answer `"service": "job-hunter"`, with a bounded
  connect and a bounded read, before treating a listener as its own backend.
  *Commit: `998e473`.*
- **TASK 005 — The diagnostic panel.** `frontend/src/views/DiagnosticsView.tsx`
  shows the backend state, the interpreter and backend package the shell
  resolved as a pair, the port, the model runtime with a per-stage table and
  the `ollama pull` command for anything missing, the data directory, the
  database and log files with their sizes, and the log tail in local time
  against a labelled column. `/api/info` reports all of it and
  `POST /api/diagnostics` assembles the copied report through the same
  redaction filter the log writes through. The shell now reports **process
  provenance**: a spawned backend reads as normal, an adopted one is labelled
  as attached and says its output is not captured. Reachable from Settings,
  and it replaces the startup screen once the backend has failed or twenty
  seconds have passed. *Commit: `PENDING`.*

## Current work unit

**TASK 006b — Rescue the stale database, create this file, migrate
`CLAUDE.md` to the playbook template.** See the report delivered with this
change for full detail: the archived database, the live database, and what
each acceptance criterion confirmed.

## Next work unit

**TASK 007 — backend supervision.** A health poll every ten seconds, one
automatic restart on a failed poll, and the diagnostic panel with the log tail
on a second failure. The panel is already built to show it: an adopted backend
is labelled as one supervision cannot restart, so TASK 007 only has to decide
what it does rather than how it is displayed. After Phase A: TASK 008
(Alembic), then 013–019 (truthfulness and documents), then 021–024 (sources).

## What Phase A taught us

- **Two defects this phase were found by provoking the failure, not by
  reading code**: `bundle.resources` took precedence over the venv and made
  the probe look inside the packaged copy instead of the repository; a socket
  that accepts a connection and then stays silent made the 20-second startup
  timeout unreachable, because anything that only connects cannot tell that
  case from a healthy backend. Every brief from now on requires reproducing
  the failure before proposing the fix.
- **A green test suite is not evidence for anything a user sees or a process
  does.** Behaviour claims — a screen renders, a timeout is reached, a
  process is adopted or refused — need a run against the real binary, not a
  passing `pytest` or `tsc`.
- **Data written by a previous code path can outlive the code path.** The
  292-job database this task rescued from `src-tauri/target/` was written
  before the data directory was settled on `%LOCALAPPDATA%\JobHunter`; the
  code that wrote it there is gone, but the data was not, and it sat inside a
  directory `cargo clean` deletes. Check for orphaned data before assuming a
  build-output directory is disposable.

## Open items

| Item | Owner |
|---|---|
| `JOB_HUNTER_DATA_DIR` and `JOB_HUNTER_DATABASE_URL` are used verbatim, so a relative value resolves against the working directory. This is how the `.tmpdata` database came to exist. Resolve both to absolute paths at startup and reject a relative value, before any migration ever runs. | TASK 008 |
| No health poll and no automatic restart. The shell notices a child that exits and does nothing further. | TASK 007 |
| A backend the shell adopts rather than spawns has no child handle: it is not killed on shutdown and supervision cannot restart it. No longer silent — TASK 005 made the panel label it as attached and state that its output is not captured — but the behaviour itself is still TASK 007's to decide. | TASK 007 |
| The live database holds **2 candidate rows** where a single-profile product allows exactly one. TASK 013 must resolve the duplicate and add a constraint enforcing one: every generated document is rendered from profile fields, so an arbitrary pick between two rows is a truthfulness defect, not a tidiness one. | TASK 013 |

## Reproducibility note

`opencode.json` pins `qwen3-coder:30b-32k`, a tag built locally from a
`Modelfile` that TASK 006 deleted. The tag still exists on this machine but
can no longer be rebuilt from the repository. To reproduce it:

```
FROM qwen3-coder:30b
PARAMETER num_ctx 32768
```
