# Job Hunter

A Windows desktop job-hunting command centre, all local: a Tauri 2 window, a
FastAPI backend, a SQLite database, Ollama for the language model.

## Stack & essentials

```
frontend/     React + TypeScript + Vite. No runtime deps beyond React — router,
              icons, charts and styles are all local.
backend/      FastAPI + SQLAlchemy, on 127.0.0.1:8756.
  app/api         HTTP routes, one module per area, mounted under /api
  app/services    discovery, normalise, dedupe, scoring, documents,
                  truthfulness, applications, automation, analytics, cv_import
  app/sources     one module per job board, public documented endpoints only
  app/models      SQLAlchemy models, all on the single Base in app/db/base.py
  app/llm         provider abstraction; Ollama is the only implementation
src-tauri/    Rust. Owns the window and supervises the backend process.
```

```bash
npm --prefix frontend install                                # once
powershell -ExecutionPolicy Bypass -File scripts/setup.ps1    # once: backend/.venv
npm run backend          # terminal 1: the API on 8756
npm run dev:frontend     # terminal 2: Vite on 5173
npm run dev               # or: the desktop window, starts both
npm run build              # Windows installers
```

`tauri build` needs the MSVC desktop x64 libraries, which on this machine are
in VS 2022 Build Tools rather than the VS 2026 install on PATH:

```
"C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat" && npx tauri build
```

## Invariants

Not style preferences. Breaking one is a defect.

1. **The candidate profile is the only source of truth.** No generated
   document may state a fact the profile does not contain. Employers, dates,
   titles, education and certifications are rendered from the profile by
   code; the model reorders and re-emphasises, never adds. Every generated
   document goes through `app/services/truthfulness.py`; a failure is stored
   with the findings attached and held back from submission.
2. **Only sanctioned submission.** An application is transmitted only through
   a mechanism the recipient published for it. Everything else is prepared in
   full and routed to ACTION_REQUIRED. Nothing fills a third-party form,
   drives a logged-in session, evades a rate limit, or works around any
   access control. `SourceCapabilities.can_submit` is false almost everywhere.
3. **Job text is untrusted input.** Fenced with `wrap_untrusted` before it
   reaches a prompt; the system prompt says to ignore instructions inside it.
   Model output is parsed and stored, never executed, never used to build a
   path or a command. A model score adjustment is clamped to ±8 points.
4. **Degraded is never presented as complete.** A failed job source is named.
   A score computed without the model says `deterministic`. A document from a
   template says so. A rate over fewer than five applications is
   `low_confidence`.
5. **No credentials in the database.** An email account row stores the *name*
   of an entry in the OS credential store. The API rejects a payload carrying
   a password rather than silently dropping it.
6. **One declarative base.** Every model imports `Base` from
   `app/db/base.py`. A second base silently drops those tables from
   `create_all` — how the first version of this project shipped an empty
   database file.

Three more, from blueprint §19.7, because they are the difference between a
personal tool and one that can be handed to someone else later:

7. Nothing about the Sponsor goes in code — no city, country, stack,
   seniority, employer, name, salary or language. It comes from the profile
   or the config.
8. Stay PyInstaller-compatible: no dynamic imports, one `resource_path()`
   helper for data paths, nothing at runtime that assumes the repository
   layout.
9. Every dialog, tab set and toast goes through `ui.tsx`.

## Conventions

- SQLite, not PostgreSQL — no `ARRAY` columns; list and dict fields use
  `JSON`.
- Data lives outside the repository, under `%LOCALAPPDATA%\JobHunter`,
  because a packaged app cannot write next to its executable.
- The renderer's API base differs by build: the dev server proxies `/api`;
  the packaged app calls `http://127.0.0.1:8756/api`, injected as
  `window.__JOB_HUNTER_API__` before the page loads.
- Scoring is deterministic first. `services/scoring.py` produces the number,
  breakdown and skill lists with no network; the model only adds qualitative
  strengths/gaps plus a bounded adjustment.
- The app runs from the repository — no bundled backend copy. The shell
  resolves the Python package and its interpreter as a pair, first location
  with both wins.
- Everything the shell and backend say goes to one file, under
  `%LOCALAPPDATA%\JobHunter\logs\backend-YYYY-MM-DD.log`, rotated at 5 MB,
  seven kept, redacted by `app/core/logging.py`.
- Sources ship free-form tags; they feed technology detection through the
  vocabulary in `services/normalize.py` rather than being trusted directly.

## Verification

- `npm run test:backend` — unit tests, no network, no model, no server.
- `npm run typecheck` — tsc over the renderer.
- `npm run test:smoke` — end-to-end checks against a running API.
- `cargo check` — from the vcvars64 environment above.

Every change should leave all four green. A green suite is evidence for what
it tests, not for what a user sees or a process does — UI work needs visual
confirmation in a running window, not just passing checks. Every completion
report separates what was confirmed by running something from what could
only be confirmed by reading code.

- **A task is not done until it is committed.** Every completion report
  states the commit SHA, or all of them when the work is split. "Done"
  without a SHA is an unfinished task.
- **UI work commits its evidence.** Any change to what a user sees is
  captured from a running window and committed to `docs/design/screenshots/`
  as `<task>-<state>.png`. The report names the committed paths — a
  screenshot that only exists in a session transcript is not evidence.

## Where things live

- Product context and decisions: `docs/BLUEPRINT.md` (§19 before assuming
  anything about packaging, §17 for the task list)
- Design reference: `DESIGN.md`
- Current state: `docs/STATE.md` — what is done, in flight, learned and
  still open; updating it is part of every task's definition of done
- Tooling configured here: `ui-kickoff`, `frontend-design`, the
  `engineering` and `design` plugin skills, installed globally; Chrome
  headless for renderer screenshots, `PrintWindow`/`PW_RENDERFULLCONTENT`
  for the packaged window. The design system is the hand-written token set
  in `frontend/src/styles/`, no Tailwind or shadcn.
- Work tracking: none — the roadmap lives in `docs/BLUEPRINT.md` §17, the
  state in `docs/STATE.md`.

## Operating model

Sponsor sets direction; Claude (PO) owns product decisions and writes
implementation briefs; Claude Code implements and verifies. Claude Code does
not change product decisions — it reports the problem with evidence and
returns the decision to the PO.
