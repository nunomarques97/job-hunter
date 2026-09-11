# Current state

Where the work actually is. `docs/BLUEPRINT.md` is the plan and `CLAUDE.md` is
the standing rules; neither carries progress. This file does, and updating it is
part of every task's definition of done.

## Work units completed, newest first

**TASK 006 — Stop adopting a stranger's server, and stop racing the API address.**
The shell asks `GET /api/health` and requires `"service": "job-hunter"` before it
treats a listener as its own backend, with a bounded connect and a bounded read.
A foreign listener is named in the log and the search moves to the next port; a
range with nothing free is `StartError::PortUnavailable`, which names the port
and says what to close. The API address now goes into the window through
`initialization_script()` instead of `window.eval` at page load, so
`'unsafe-inline'` is out of `script-src`. Housekeeping in the same unit: the
stale `target/release/backend/` moved aside, the root `Modelfile` deleted with
`num_ctx` sent per request and the default model changed to `qwen3:8b`, and the
`.opencode/` agents and skills rewritten to reference the blueprint.
*Commits: `998e473`, `e5e665d`.*

**TASK 003 + TASK 004 — Show the window first, and write every diagnostic to a
file.** The window is created and shown in `setup()` before the backend thread
starts, so a sick backend no longer costs ninety seconds of nothing. Everything
the shell and the backend say goes to one rotated file under
`%LOCALAPPDATA%\JobHunter\logs`, through a redaction filter. `bundle.resources`
and the duplicate backend copy removed; `legacy/` deleted. The renderer's
startup screen reaches its twenty-second timeout state even when the health
probe never settles. *Commits: `06ae11c`, `326796b`, `5537bdb`.*

**TASK 001b — One-time environment setup.** `scripts/setup.ps1` creates
`backend/.venv` and installs the pinned requirements. `python_command()` probes
only interpreters belonging to this installation; the bare `"python"` fallback
is gone, because on Windows it resolves to the Microsoft Store alias stub, which
spawns successfully and never serves anything. A missing environment is a typed
error in under two seconds. *Commit: `000b836`.*

## Current work unit

None. TASK 006 is complete and verified.

## Next work unit

**TASK 005 — the diagnostic panel in Settings.** It is the last of the Phase A
items in blueprint §19.6, and `backend_status()` and `backend_log_tail()` already
exist for it to render. After Phase A the MVP list is TASK 008 (Alembic), then
013–019 (truthfulness and documents), then 021–024 (sources).

## Learned this phase

Things found by implementation that are not in the blueprint, and that a future
session would otherwise rediscover.

- **`bundle.resources` beat the repository.** It copied `backend/app` next to
  the executable, and the shell resolved the backend package to that copy and
  looked for the interpreter inside it — never finding the one `setup.ps1`
  creates. The package and the interpreter are now resolved as a pair, first
  complete location wins. This is recorded in blueprint §19.2 as a correction.

- **A socket that accepts and stays silent is the hard case, not a dead port.**
  A refused connection is instant and unambiguous. A socket that completes the
  handshake and never answers looks exactly like a healthy backend to anything
  that only connects, and it will hold an unbounded reader for ever. It cost two
  separate fixes: the renderer's `fetch` (`5537bdb`) and the shell's probe
  (TASK 006). Anything that waits on the backend needs its own bound.

- **Windows turns a close with unread received data into a reset, and a reset
  discards what the peer had already buffered.** A test server that replies
  without first draining the request will sometimes deliver nothing at all. The
  decoys in `src-tauri/src/backend.rs` read the request before answering for
  this reason, and the failure is intermittent, so it looks like a flake.

- **A process started from a background session comes up minimised.** Its client
  rectangle is 0×0 and a screenshot of it is empty. Restore the window before
  capturing. This is a property of the capture environment, not of the app.

- **`cargo` needs the VS 2022 Build Tools environment on this machine**, not the
  VS 2026 install that is first on PATH. Every `cargo` command, not just
  `tauri build`. `CLAUDE.md` has the `vcvars64.bat` line.

- **The window can stay declared in `tauri.conf.json` while being built in
  Rust.** `"create": false` on the window config stops Tauri opening it, and
  `WebviewWindowBuilder::from_config` rebuilds it from that same config, so its
  size, title and colours do not have to move into Rust to attach an
  initialization script.

## Open items

- **A cwd-relative database path is still reachable.** `JOB_HUNTER_DATA_DIR` and
  `JOB_HUNTER_DATABASE_URL` are both used verbatim, so a relative value resolves
  against the working directory — which the shell sets to the backend package.
  That is how `target/release/backend/.tmpdata/job_hunter.db` came to exist.
  Nothing in the repository, the scripts or `package.json` sets either variable,
  so `%LOCALAPPDATA%\JobHunter` is the only location any current code path
  produces. Found in TASK 006 and deliberately not fixed there. *Owner: unassigned.*

- **`src-tauri/target/_stale-backend-backup/`** holds a database with 292 jobs
  and 5 applications, created before the data directory was settled. It is moved
  aside rather than deleted, and nothing reads it. Delete it once the Sponsor
  confirms nothing in it is wanted. *Owner: Sponsor.*

- **`opencode.json` pins `ollama/qwen3-coder:30b-32k`**, a tag that only existed
  because of the `Modelfile` TASK 006 deleted. The tag is still present on this
  machine, so OpenCode still runs, but it cannot be rebuilt from the repository.
  Its five agent definitions also name `ollama/qwen3:14b`, which the provider
  block does not declare. *Owner: Sponsor — it is his fallback agent config.*

- **`job_hunter.db` and `backend/app/job_hunter.db`** are both zero bytes and
  untracked leftovers from the era the blueprint describes in rule 6. Harmless,
  and not deleted without being asked.

- **No supervision beyond first start.** The shell notices a child that exits,
  but there is no health poll, no restart and no crash recovery. Blueprint §14.3
  wants a poll every ten seconds and one automatic restart. *Owner: unassigned,
  post-MVP.*
