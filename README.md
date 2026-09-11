# Job Hunter

A job-hunting command centre that runs entirely on your own Windows machine.

It discovers jobs from public boards, scores every one against your profile,
prepares a tailored CV and cover letter, and tracks each application through a
pipeline — without inventing anything about you and without submitting anywhere
the employer has not invited it to.

## What it does

**Discover** from public job-board APIs — Greenhouse and Lever company boards,
RemoteOK, and the monthly Hacker News hiring thread — plus a sample set for
trying it offline.

**Normalise and deduplicate**, so the same vacancy from four boards is one row
with the others linked to it, and so every posting has comparable fields whatever
shape the source sent.

**Score** each posting 0–100 against your profile across six weighted dimensions:
skills overlap, role match, seniority fit, location and working arrangement,
salary, and how recent the posting is. The arithmetic runs with no network and
gives the same answer every time; the local model then adds qualitative strengths
and gaps and a correction of at most eight points. Every score shows its
breakdown, so the number is explained rather than asserted.

**Generate** a tailored CV and cover letter for a specific job. Your employers,
dates, titles, education and certifications are rendered straight from your
profile by code. The model may reorder sections and re-emphasise a bullet; it
cannot add a fact. Every generated document is then checked against what you
declared, and one that names a technology or a date you never entered is held
back with the reason attached.

**Track** each application across eleven pipeline stages on a Kanban board, with
a full audit trail of every move.

**Follow up** on applications that have gone unanswered, with the draft prepared.

**Analyse** response, interview and offer rates, source performance, the funnel,
salary spread and technology demand — every rate shown with its numerator and
denominator, and marked when there is too little data to mean anything.

## What it will not do

- **It will not fabricate.** No experience, employer, date, technology,
  qualification, achievement or certification that is not on your profile can
  appear in a document it generates.
- **It will not submit where it has not been invited.** An application is sent
  only through a mechanism the employer published for it. Everything else is
  prepared in full, marked *action required*, and opened in your browser for you
  to finish. Most postings fall in this category, and that is the honest answer.
- **It will not work around any control.** Sources are read through the public
  endpoints their publishers document for programmatic access. There is no
  CAPTCHA handling, no anti-bot evasion, no authentication bypass, no rate-limit
  evasion, and no detection evasion anywhere in this codebase.
- **It will not phone home.** The application talks to job boards, to your local
  model, and to nothing else. Your profile, documents and applications stay in a
  SQLite file on your machine.

## Requirements

- Windows 10 or 11
- Python 3.11 or newer
- [Ollama](https://ollama.com) with a model pulled, for tailoring and analysis.
  The product works without it: scores fall back to the deterministic
  calculation, documents come from templates, and both say which path they took.

## Setting up

Two steps, once:

```bash
npm --prefix frontend install
powershell -ExecutionPolicy Bypass -File scripts/setup.ps1
```

The second creates `backend/.venv`, installs the pinned dependencies into it,
and checks that every one of them imports. Nothing is installed system-wide, and
the application launches that interpreter and no other: if `backend/.venv` is
missing it says so at once rather than searching the PATH.

Your data lives in `%LOCALAPPDATA%\JobHunter`.

## Running it

```bash
npm run backend         # the API on 127.0.0.1:8756
npm run dev             # the desktop window, with the renderer hot-reloading
```

## Building from source

```bash
npm run build
```

The Rust link step needs the MSVC desktop x64 libraries from a Visual Studio C++
workload. Run `npx tauri build` from that developer environment if the linker
reports it cannot open `msvcrt.lib`.

The installers land in `src-tauri/target/release/bundle/`, but they are not how
this is run. The backend is not bundled: the window looks for `backend/` and the
virtual environment beside it, starting from where it was launched. Run
`src-tauri/target/release/job-hunter.exe` from this checkout, or `npm run dev`.
An installed copy started from the Start menu finds no backend and says so.

## Testing

```bash
npm run test:backend    # 75 unit tests, offline
npm run typecheck       # the renderer
npm run test:smoke      # 43 end-to-end checks against a running API
```

`docs/BLUEPRINT.md` is the product and architecture source of truth.
`CLAUDE.md` describes the architecture and the rules the code is built on.
`DESIGN.md` is the visual system every screen follows.

## Licence

The reference projects that informed this design — MR.Jobs (MIT), AI Job Hunter
(Apache 2.0) and ApplyPilot (AGPL-3.0) — were read for architecture and workflow
ideas. No code was copied from any of them; every module here is original.
