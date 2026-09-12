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
  seconds have passed. *Commit: `d10ada4`.*

- **TASK 006b — Rescue the stale database, restructure this file, migrate
  `CLAUDE.md` to the playbook template.** The archived database and the live
  database are as described in the report delivered with this change. Split
  across two commits: the `docs/STATE.md` half landed inside `d10ada4`
  (folded into the TASK 005 commit by mistake instead of getting its own),
  the `CLAUDE.md` half is `054d878`.

- **TASK 007 — Backend supervision, and five honesty fixes in the panel.**
  The shell polls `GET /api/health` every ten seconds once the backend is up.
  A backend this window spawned is restarted **once per window session** — not
  once per failure — and the restart, its reason and its time are written to
  the log and shown in the panel, so nothing silently re-arms. A second failure
  stops and shows the diagnostic panel with the log tail. A backend the window
  *adopted* is polled and never restarted: the panel says it has stopped, that
  this window cannot restart something it did not start, and where it was
  running — the interpreter and data directory the service reported for itself,
  read from `/api/info` at adoption while it could still answer. Shutdown is
  unchanged: a spawned child dies with the window, an adopted one keeps
  running. Five panel fixes landed with it: the adopted interpreter row says
  "the same interpreter" when it matches the one the service reports rather
  than "not in use"; the unreachable state's port reads as the one it *would*
  have used; the log tail is labelled as the end of today's file and marks
  where this launch began; the first log line is no longer clipped in half
  (the scroll box is now a whole number of 20px lines); and the Dashboard says
  "1 strong match", not "matches". *Commits: `8abbae2`, `2805e09` (the adopted-stopped
  remedy, which promised a recovery this window cannot make).*

- **TASK 007b — An honest window in the degraded state.** Three things TASK 007
  left, all the same family. **The chrome no longer pretends to load.** The
  startup screen used to draw a skeleton of the shell — ten blank pills, a grey
  search block, no footer — and a skeleton means "wait" for a wait that never
  ends. The real shell renders in every backend state now and is told the
  condition instead: every rail label is readable, the screens that need the
  service are disabled with the reason stated once above them, the footer says
  the condition and leads to the panel, and Settings and Diagnostics stay
  clickable. Settings itself no longer shows empty cards where the service could
  not answer. **One clock.** The exhausted-restart sentence carried a UTC stamp
  welded into it and sat directly above the same moment in local time;
  `StartFailure` now carries the instant beside the sentence as `at`, the log
  line keeps UTC and the panel prints local. **An adopted backend that comes
  back is picked up again.** The window keeps polling after one stops, re-reads
  `/api/info` on re-attachment because the kept answer describes a process that
  is gone, and says in the panel and the log when it happened. Re-attaching is
  not a restart and spends none of the one-restart budget; "Check again" now
  drives it through a new `backend_recheck` command rather than only redrawing.
  *Commit: `8c0a814`.*

## Current work unit

None. Phase A is closed.

## Next work unit

**TASK 008 — Introduce Alembic.** `init_db` runs `alembic upgrade head`
instead of `create_all`; an existing database is stamped at the baseline
revision without data loss. It also owns the `JOB_HUNTER_DATA_DIR` /
`JOB_HUNTER_DATABASE_URL` resolution below, which must be settled *before* a
migration ever runs. After that: 013–019 (truthfulness and documents), then
021–024 (sources).

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
- **A process you did not start can only be asked about itself while it is
  still alive.** An adopted backend leaves nothing behind when it stops — no
  exit code, no child handle, no output in our log — so TASK 007 reads
  `/api/info` at adoption and keeps the answer. Every other design produced the
  same useless sentence on the panel: "a service stopped", with no way to say
  which one. The general rule: capture what you will need from a resource you
  do not own at the moment you attach to it, not at the moment you need it.
- **A loading state is a promise, and a promise the window cannot keep is a
  lie.** The degraded chrome was not a missing feature. It was the shell's
  loading state left switched on for a condition that never resolves, on ten
  labels that are static text and never needed the backend at all. Before
  drawing a skeleton, ask what will replace it and whether that thing is
  actually coming.
- **Driving the window is part of the verification, and the pointer has to be
  proven to have landed.** Two runs in this task looked like a fix had failed
  when the click had simply gone to the wrong screen: the renderer had not yet
  switched to the panel, and the first click after `SetForegroundWindow` is
  eaten by activation. Screenshot before clicking, and prove a timed action by
  where it falls between two known clock marks.
- **Verification evidence that is not committed is verification that did not
  happen.** TASK 005's three screenshots were rendered inside a session and
  lost when it ended; TASK 005b had to re-run every state from scratch to get
  evidence a later session could actually check against. The next session
  cannot compare the current screen to the approved one from a description in
  a transcript nobody kept.

## Open items

| Item | Owner |
|---|---|
| `JOB_HUNTER_DATA_DIR` and `JOB_HUNTER_DATABASE_URL` are used verbatim, so a relative value resolves against the working directory. This is how the `.tmpdata` database came to exist. Resolve both to absolute paths at startup and reject a relative value, before any migration ever runs. | TASK 008 |
| **Invariant 4 is breached on the Dashboard, and the arithmetic underneath it is wrong in a way the screenshot does not show.** Two findings, together because they are the same twenty lines of code. (a) *Confirmed in code.* `services/analytics.py` computes `low_confidence` on every rate and returns the numerator and denominator with it; `AnalyticsView.tsx:274` honours it. `DashboardView.tsx:142-156` does not — the Interviews and Offers tiles render `${percent(value)} of sent` and drop `low_confidence`, the numerator and the denominator. The live database has three submitted applications, so "33.3% of sent" is shown unlabelled over a denominator of 3 where `CLAUDE.md` rule 4 requires `low_confidence` under five. (b) *Checked against the code, and the suspicion in the brief was wrong about the mechanism.* The denominator is **not** weekly: `applications_submitted` and the rates are all-time, and `applications_submitted_this_week` is only the delta chip. The real defect is that numerator and denominator use two different definitions of the same thing — the numerator is a **current stage** count (`stage == INTERVIEW`) while the denominator is a **lifetime event** count (`submitted_at is not null`). So an application that moves from Interview to Offer silently leaves the interview numerator, and the pipeline's four non-archived rows against the tile's three submitted show at least one row sitting in a post-submission stage with no `submitted_at`. Fix both together; the second is not visible from any screenshot. | TASK 029 |
| **Two named normalisation failures, both visible on the Dashboard's recent matches.** (a) A repeated location token: *Engineer Estimator*, Crystalia Glass LLC, renders as "Bishkek, Bishkek, Bishkek …" — city, region and country are the same word and are concatenated rather than collapsed. (b) Two spellings of one value are not reconciled: *Software Engineer III Mobile*, Stone, renders "Remoto" while *DESARROLLADOR FULL STACK*, Kruger NearShore LLC, renders "Remote". Both are real rows in the live database, so they are test inputs, not hypotheticals. | TASK 023 |
| The live database holds **2 candidate rows** where a single-profile product allows exactly one. TASK 013 must resolve the duplicate and add a constraint enforcing one: every generated document is rendered from profile fields, so an arbitrary pick between two rows is a truthfulness defect, not a tidiness one. | TASK 013 |

## Reproducibility note

`opencode.json` pins `qwen3-coder:30b-32k`, a tag built locally from a
`Modelfile` that TASK 006 deleted. The tag still exists on this machine but
can no longer be rebuilt from the repository. To reproduce it:

```
FROM qwen3-coder:30b
PARAMETER num_ctx 32768
```
