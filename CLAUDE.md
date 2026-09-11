# Job Hunter

A Windows desktop job-hunting command centre. Everything runs on the user's own
machine: a Tauri 2 window, a local FastAPI backend, a SQLite database, and Ollama
for the language model.

All UI work must follow DESIGN.md.

## The source of truth

`docs/BLUEPRINT.md` is the product and architecture source of truth. Read it
before proposing scope, and read §19 before assuming anything about packaging.
Three constraints from §19.7 apply to every change, and are not repeated here:

1. Nothing about the Sponsor goes in code. No city, country, stack, seniority,
   employer, name, salary or language. It comes from the profile or the config.
2. Stay PyInstaller-compatible. No dynamic imports, one `resource_path()` helper
   for data paths, nothing at runtime that assumes the repository layout.
3. Every dialog, tab set and toast goes through `ui.tsx`.

## Shape of the repository

```
frontend/     React + TypeScript + Vite. The renderer. No runtime dependencies
              beyond React: the router, icons, charts and styles are all local.
backend/      FastAPI + SQLAlchemy. Runs on 127.0.0.1:8756.
  app/api         HTTP routes, one module per area, mounted under /api
  app/services    The domain: discovery, normalise, dedupe, scoring, documents,
                  truthfulness, applications, automation, analytics, cv_import
  app/sources     One module per job board, all public documented endpoints
  app/models      SQLAlchemy models, all on the single Base in app/db/base.py
  app/llm         Provider abstraction; Ollama is the only implementation
  tests/          test_units.py (offline) and smoke_workflow.py (needs the API)
src-tauri/    Rust. Owns the window and supervises the backend process.
```

## Running it

```bash
npm --prefix frontend install                              # once
powershell -ExecutionPolicy Bypass -File scripts/setup.ps1 # once: backend/.venv
npm run backend                   # terminal 1: the API on 8756
npm run dev:frontend              # terminal 2: Vite on 5173
npm run dev                       # or: the desktop window, which starts both
```

Build the Windows installers:

```bash
npm run build
```

The Rust link step needs the MSVC desktop x64 libraries. On this machine they are
in the VS 2022 Build Tools rather than the VS 2026 install, so `tauri build` has
to run from that developer environment:

```
"C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat" && npx tauri build
```

## Testing

```bash
npm run test:backend    # 75 unit tests, no network, no model, no server
npm run typecheck       # tsc over the renderer
npm run test:smoke      # 43 end-to-end checks against a running API
```

Every change should leave all three green. The smoke test is written to pass
against a database that already holds data, so it can be pointed at a real
installation.

## The rules this product is built on

These are not style preferences. Breaking one is a defect.

1. **The candidate profile is the only source of truth.** No generated document
   may state a fact the profile does not contain. Employers, dates, titles,
   education and certifications are rendered from the profile by code; the model
   is allowed to reorder and re-emphasise, never to add. Every generated document
   goes through `app/services/truthfulness.py`, and one that fails is stored with
   the findings attached and held back from submission.

2. **Only sanctioned submission.** An application is transmitted only through a
   mechanism the recipient published for it. Everything else is prepared in full
   and routed to ACTION_REQUIRED with the package retained. Nothing in this
   codebase fills a third-party form, drives a logged-in session, evades a rate
   limit, or works around any access control. `SourceCapabilities.can_submit`
   states the truth for each source and is false almost everywhere.

3. **Job text is untrusted input.** It is fenced with `wrap_untrusted` before it
   reaches a prompt, and the system prompt says to ignore instructions inside it.
   Model output is parsed and stored, never executed, never used to build a path
   or a command, and never allowed to decide what the application does next. A
   model score adjustment is clamped to ±8 points.

4. **Degraded is never presented as complete.** A failed job source is named. A
   score computed without the model says `deterministic`. A document from a
   template says so. A rate over fewer than five applications is marked
   `low_confidence`.

5. **No credentials in the database.** An email account row stores the *name* of
   an entry in the OS credential store. The API rejects a payload carrying a
   password rather than silently dropping it.

6. **One declarative base.** Every model imports `Base` from `app/db/base.py`. A
   second base silently removes those tables from `create_all`, which is exactly
   how the first version of this project shipped an empty database file.

## Things worth knowing

- **SQLite, not PostgreSQL.** `ARRAY` columns do not exist here; list and dict
  fields use `JSON`.
- **Data lives outside the repository**, under `%LOCALAPPDATA%\JobHunter`, because
  a packaged app cannot write next to its executable. Override with
  `JOB_HUNTER_DATA_DIR`.
- **The renderer's API base differs by build.** The dev server proxies `/api`; the
  packaged app is served from `tauri://localhost` and must call
  `http://127.0.0.1:8756/api`. The shell injects the real address as
  `window.__JOB_HUNTER_API__` before the page loads.
- **Scoring is deterministic first.** The arithmetic in `services/scoring.py`
  produces the number, the breakdown and the skill lists with no network. The
  model only adds qualitative strengths and gaps plus a bounded adjustment. A
  score the user cannot reproduce is a score they cannot trust.
- **The app runs from the repository.** There is no bundled copy of the backend:
  the shell resolves the Python package and the interpreter as a pair and takes
  the first place that has both, which is `backend/` next to `backend/.venv`.
- **Everything the shell and the backend say goes to one file**, under
  `%LOCALAPPDATA%\JobHunter\logsackend-YYYY-MM-DD.log`. The shell owns it,
  rotates it at 5 MB and keeps seven. The backend writes to stdout and the shell
  pipes it in, so there is one writer per file and `npm run backend` still
  prints to the terminal. Every line passes `app/core/logging.py`'s redaction
  filter, which is what keeps credentials and document bodies out of it.
- **Sources ship free-form tags.** They feed technology detection through the
  vocabulary in `services/normalize.py` rather than being trusted as
  technologies, or the filters fill up with "digital nomad" and "exec".

## Tooling configured here

- `ui-kickoff`, `frontend-design`, the `engineering` and `design` plugin skills:
  installed globally.
- Chrome headless for renderer screenshots; `PrintWindow` with
  `PW_RENDERFULLCONTENT` for capturing the packaged window.
- Not configured, and not needed for this stack: shadcn and its registries, and
  Impeccable. The renderer has no Tailwind or shadcn; its design system is the
  hand-written token set in `frontend/src/styles/`.
