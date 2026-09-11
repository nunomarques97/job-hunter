# Job Hunter — Product & Architecture Blueprint

**Author:** Product Owner (analysis session, 11 Sep 2026)
**Audience:** the Developer agent (Claude Code) and the Sponsor
**Status:** analysis only — no code was modified, no files were created in the repository
**Method:** full read of `C:\Users\User\ollama-projects\job-hunter` (backend, frontend, Tauri, tests, docs, `mock.png`) and of the three reference repositories in `C:\Users\User\Desktop\JOB Search` (`ai-job-hunter-app`, `ApplyPilot`, `mr-jobs`).

> **Where this document should live.** The Developer should commit this as `docs/BLUEPRINT.md` and add a pointer to it from `CLAUDE.md`. It supersedes any earlier roadmap. It does **not** supersede `DESIGN.md`, which remains the visual authority.

---

## 0. Audit correction notice

Two findings raised during the audit are **withdrawn** after verification:

| Withdrawn finding | Reality |
|---|---|
| "`backend/app/db/__init__.py` is missing → the backend cannot start" | The file exists and correctly re-exports `Base, TimestampedBase, utcnow, SessionLocal, engine, get_db, init_db, session_scope`. This was an artefact of the file-transfer step, not a defect. |
| "`requirements.txt` pins versions that do not exist on PyPI" | **Unverified** — PyPI was unreachable from the analysis environment. The Developer must run `pip download -r backend/requirements.txt` on a clean machine to confirm. The real finding stands regardless (§5, P0-2): resolving dependencies from PyPI *at runtime on a user's machine* is not a viable install strategy. |

Every other finding below was reproduced against the actual source.

---

# 1. Executive assessment

## 1.1 The verdict in one paragraph

Job Hunter is a **well-reasoned product with an unusually honest engineering culture and a genuinely dangerous gap between what it claims and what it does**. `CLAUDE.md` states six rules; three are enforced in code (untrusted-input fencing, the ±8 LLM clamp, sanctioned-submission-only), one is enforced in parts (degraded-is-labelled), one is enforced structurally (single declarative base), and **the first and most important rule — "the candidate profile is the only source of truth" — is not enforced at all**. The architecture is sound. The scoring engine is real. The analytics module is the most intellectually honest code in the repository. But the product as built cannot be installed by a non-developer, cannot produce a document any employer will accept, cannot find jobs relevant to its actual user, and never submits anything anywhere — while its dashboard reports a submission counter that is structurally always zero.

## 1.2 Where the product actually stands

| Dimension | Reality |
|---|---|
| **Backend** | ~4,700 LOC, clean layering, defensible module boundaries. Best-in-class: `analytics.py`, `documents.py` versioning, `llm/base.py` fencing. Worst: `truthfulness.py` (dead code presented as a guarantee), `automation.py` (no scheduler), the whole email package (models + routes, zero transport). |
| **Frontend** | ~5,100 LOC, zero `any`, zero `@ts-ignore`, a real hand-built design system, and **the best zero-data/first-run states I have seen in a project of this size**. Undermined by 353 inline style objects, 49% off-scale spacing, no ErrorBoundary, and no focus management. |
| **Tauri shell** | 160 lines of Rust that do the right things in the wrong order and discard every diagnostic. Correct shutdown, correct CSP, correct per-user install. No supervision, no logs, no updater, no signing, no bundled runtime. |
| **Discovery** | 4 real sources + 1 fake one, all US-centric, all keyless. For the actual target user (Porto, senior .NET + Angular) a first run yields **5 fabricated postings and a single-digit number of mostly irrelevant US remote roles**. |
| **Documents** | Markdown only. No PDF writer, no DOCX writer, nothing in `requirements.txt` that could produce either. |
| **Submission** | Never happens. `route_for_submission` cannot return `SUBMITTED`; the counter is dead code. |
| **Packaging** | `bundle.resources` ships Python *source* and a `requirements.txt`. Nothing installs Python, nothing installs the dependencies, nothing pulls the model. On a vanilla Windows 11 machine the user sees **90 seconds of no window**, then a window where every panel says "the local backend is not responding", with no log file anywhere on the machine. |

## 1.3 The strategic disagreement — read this before the roadmap

The brief states the main objective as:

> *"maximize the number of relevant job applications produced with minimal manual work"*
> *"submit automatically where legitimate supported mechanisms exist"*

**The second sentence is a trap, and the three reference repositories prove it independently.**

- **`ai-job-hunter-app`** *built* a browser-automation apply engine with per-board appliers, a form filler and a CAPTCHA handler — and then **deleted all of it** (PR #7, 2026-06). Their recorded reason: *"selector drift, captcha, and per-board form logic made an auto-submit engine too costly to maintain."* They now ship 12 ATS **read** adapters and **zero** ATS write adapters, and their own assisted autofill cannot reach an iframe — which is exactly where every embedded Greenhouse/Lever/Ashby form lives. They call the product an *apply assistant*.
- **`ApplyPilot`** *does* auto-submit — by spawning `claude -p --permission-mode bypassPermissions`, driving a real Chrome over CDP with a stealth-patched Playwright fork, injecting MAIN-world overrides of `navigator.webdriver`, paying CapSolver to solve hCaptcha, and generating a per-install random RSA extension key explicitly *"to defeat LinkedIn's bulk fingerprint of ApplyPilot's extension."* Every one of those techniques is on Job Hunter's prohibited list. Strip them out and ApplyPilot's apply engine does not function. Its README headline is *"Applied to 1,000 jobs in 2 days"*; its own closing paragraph says *"blasting every ATS and every job board shouldn't be the goal… adding more volume doesn't fix that — it makes it worse for everyone."*
- **`mr-jobs`** auto-fills forms via an LLM reading an accessibility tree, and has **zero** CAPTCHA handling — `grep -i captcha` returns nothing across the entire repository. It also has no human-in-the-loop pause primitive. Its advertised "YOLO continuous mode" therefore burns its step budget silently on the first login wall it meets.

**Conclusion, and this is a Product Owner decision, not an opinion:** within the ethical boundary the Sponsor himself set, "submit automatically" is a feature with an addressable market of approximately zero postings. The legitimate mechanisms that exist are (a) `mailto:` applications and (b) nothing else at meaningful volume. Neither Greenhouse, Lever, Ashby nor Workable publishes a candidate-side submission API for third parties.

**So the product objective must be restated:**

> **Job Hunter does not apply for you. It makes applying take two minutes instead of forty-five, and makes sure you never lose track of one.**

Concretely: find the jobs the user would never have found, prove in numbers why each one fits, produce a truthful tailored CV + cover letter + pre-answered screening questions as a real PDF/DOCX package the user can attach, open the employer's own form, and track the outcome. Volume is achieved by **collapsing the cost of each application**, not by removing the human from the submit click.

This is not a retreat. It is the only version of the brief that can actually be built, and it is the version all three references converged on the hard way. Everything in the roadmap below follows from it.

## 1.4 The four things that block shipping, in order

1. **The product cannot be installed.** No bundled Python runtime → P0.
2. **The product cannot produce an attachable document.** No PDF/DOCX writer → P0.
3. **The product cannot find relevant jobs for its user.** No European source, no Adzuna/Jooble, phrase-substring keyword gate → P0.
4. **The product's core guarantee is not enforced.** `truthfulness.py` builds the employer allowlist and never uses it → P0.

Nothing else on the roadmap matters until those four are closed.

---

# 2. Current architecture assessment

## 2.1 Verification of the reported state

| Claim | Verdict | Evidence |
|---|---|---|
| Shared SQLAlchemy base, 11 tables | **CONFIRMED** | `app/db/base.py:19-31`; all 10 model modules import `TimestampedBase`; `models/__init__.py:6-27` |
| 5 job sources on public/documented APIs | **PARTIAL** | 4 network sources + 1 hardcoded fixture (`sample.py`). **Lever is not in `DEFAULT_ENABLED`** (`sources/__init__.py:33`) so it never runs. `sample` **is** enabled by default and injects 5 fabricated postings into real data. |
| Deterministic six-dimension scoring | **PARTIAL** | Six dimensions, weights sum to 100, arithmetic pure — except `_freshness_dimension` reads `utcnow()` (`scoring.py:174-190`), so a job re-scored tomorrow can lose 4 points. The **stored** score is the hybrid one (`use_model=True` by default, `api/jobs.py:228`), which is not reproducible. |
| Candidate-truth validation | **FALSE** | `truthfulness.py:58-65` builds `known` (employers, institutions, certifications) and **never references it again**. `_CAPITALISED_RUN` (`:31`) is defined and never used. A CV claiming "Lead Architect at Google", "AWS Solutions Architect Professional", "BSc from MIT" **passes clean** — reproduced. |
| 11-stage application pipeline | **PARTIAL** | 11 stage strings exist; **there is no state machine.** `PATCH /{id}/stage` (`api/applications.py:163`) validates membership only — `rejected → discovered` is accepted. `INTERVIEW`, `OFFER`, `REJECTED`, `CLOSED` are never set by any code path. |
| Analytics | **CONFIRMED, with a crash** | Real SQL aggregation with numerator/denominator and `low_confidence`. But `api/analytics.py:156` does `max(performance, key=lambda i: i["average_score"])` where `average_score` is `None` for any source with unscored jobs → `TypeError` → **the dashboard 500s after every discovery run that precedes scoring.** |
| Job content treated as untrusted | **CONFIRMED** | `llm/base.py:44-60` — preamble + `<<<UNTRUSTED_X>>>` fence + fence-token stripping, applied at all four sites. No `eval`, no `subprocess`, no path or query built from model output. Best-implemented safety control in the codebase. |
| LLM adjustment clamped to ±8 | **CONFIRMED** | `scoring.py:333-345` — `float()` coercion in try/except, symmetric clamp, then re-bound to 0–100. Tight. |
| ACTION_REQUIRED handling | **PARTIAL** | Exists for truthfulness failures. But `route_for_submission` checks `dry_run` **first** (`services/applications.py:186-199`) and `dry_run` defaults to `True`, so **an automated run never produces a single ACTION_REQUIRED row**. |
| Tests passing | **COUNTS HONEST, EXECUTION UNVERIFIED** | 61 `check()` sites in `test_units.py`, 43 in `smoke_workflow.py` — AST-confirmed. Neither is pytest: both are linear scripts with shared mutable state where an exception at assertion 12 silently skips the remaining 49. |
| Packaged Windows installers created | **UNVERIFIED / IRRELEVANT** | The artefacts may exist, but §11 shows what they contain. |

## 2.2 Data model

11 tables, all on `TimestampedBase` (`id`, `created_at`, `updated_at`, naive UTC).

`jobs` · `job_scores` · `candidates` · `applications` · `documents` · `activity_logs` · `automation_config` · `automation_runs` · `email_accounts` · `email_messages` · `email_templates`

**Structural problems:**

- **No migrations of any kind.** Schema comes from `Base.metadata.create_all` (`db/session.py:41-45`). `create_all` never alters an existing table. The moment v0.3 adds a column, every installed user's `%LOCALAPPDATA%\JobHunter` database silently lacks it and the next read raises `OperationalError: no such column`. **For a shipped desktop app this is the one thing that cannot be retrofitted.** P1, and it gets worse every day the product has users.
- **`created_at` is unindexed on every table** yet is the sort key for `activity_logs`, `automation_runs`, `documents` and `email_messages`.
- **No uniqueness** on `email_accounts.address`, `email_templates.name`, `documents(lineage_key, version)`, or `candidates.is_active`. `documents.version` is computed as `1 + count()` — a read-then-write race.
- **`automation_config` is a "singleton" enforced only by `SELECT … LIMIT 1`.** Nothing stops N rows.
- **JSON where a relation belongs.** `Job.technologies` costs directly: `api/jobs.py:107` does `Job.technologies.like(f'%"{tech}"%')` — a substring match against serialised JSON, un-indexable, and `%`/`_` in a user's term are live wildcards. The same facet count is re-implemented in Python at `api/jobs.py:190-195` and `services/analytics.py:257-262`, both of which **load every job's technology list into memory**. `Application.stage_history` is an append-only audit trail stored as a blob rewritten wholesale on every transition — "when did anything enter INTERVIEW" cannot be answered in SQL.
- `Application.job_snapshot` is deliberate denormalisation and is correct. Keep it.

## 2.3 API surface

Everything under `/api`, no auth (defensible on loopback), **and every handler is `async def` while doing synchronous blocking SQLAlchemy I/O on the event loop.** FastAPI only offloads `def` handlers to a threadpool. Combined with the in-process automation run (§2.7) this serialises the entire API behind whatever is slowest.

Four endpoints do long-running work synchronously inside a request:

| Endpoint | Worst case |
|---|---|
| `POST /applications/{job_id}/prepare` | **two** sequential LLM calls at `llm_timeout_seconds=180` each → ~6 minutes holding a request |
| `POST /jobs/discover` | fan-out across 5 sources at 25s HTTP timeout each, `db.flush()` per job plus a dedupe query per job |
| `POST /jobs/{id}/score` | `use_model=True` by default → 180s |
| `POST /profile/import` | one LLM call at 180s |

`api.ts:99` uses bare `fetch` with **no `AbortController` and no timeout**. Nothing is cancellable.

Three further problems worth naming: `GET /applications/board` is deliberately unpaginated and issues `db.get(Job, …)` per application — a textbook N+1 that guarantees degradation as real data accumulates; `GET /automation/runs` takes `page_size` with no `le` bound, so `page_size=1000000` is accepted and `page=0` produces `offset(-25)`; and five endpoints accept a raw unvalidated `payload: dict` (`api/candidate.py:85`, `api/documents.py:104`, `api/email.py:116,215,282`).

`POST /applications/{job_id}/prepare` takes a **job** id on a prefix where every sibling route takes an **application** id. Rename it.

## 2.4 Job sources

Base class is good: `httpx.AsyncClient`, `Timeout(25.0, connect=8.0)`, honest `User-Agent`, `follow_redirects=True`, a capability object with `can_submit` that is honestly `False` everywhere.

| | Greenhouse | Lever | RemoteOK | HackerNews | Sample |
|---|---|---|---|---|---|
| Endpoint | `boards-api.greenhouse.io/v1/boards/{slug}/jobs?content=true` | `api.lever.co/v0/postings/{slug}?mode=json` | `remoteok.com/api` | Algolia `/search` + `/items/{id}` | in-process fixture |
| Auth | none | none | none | none | — |
| Pagination | none | none | none | none | — |
| Rate limit | **none** — 8 boards via `asyncio.gather` | **none** — 6 boards | none | none | — |
| Retry | **none anywhere in the package** | none | none | none | — |
| Per-board errors | **silently discarded** (`greenhouse.py:52-54`) | **silently discarded** (`lever.py:41-43`) | propagates | propagates | — |

**Defects:**

- **Greenhouse and Lever silently swallow per-board failures.** `asyncio.gather(..., return_exceptions=True)` followed by `if isinstance(item, list)`. All 8 Greenhouse boards can 404 and the source still reports `ok=True` with 0 jobs, so `discovery.partial` is `False` and the UI tells the user discovery succeeded. This is a direct violation of `CLAUDE.md` rule 4.
- **HackerNews uses relevance-ranked `/search`** with `hitsPerPage: 1` to find "the newest hiring thread". It needs `search_by_date`. `hits[0]` can be a thread from a previous year.
- **The keyword gate is a whole-phrase substring test** (`sources/base.py:183-192`). Fed `candidate.target_roles`, a target of `"Full Stack Developer"` matches only text containing that exact phrase. `"Fullstack Developer"`, `"Full-Stack Engineer"`, `"Desenvolvedor Full Stack"` all miss.
- **Default boards are hardcoded US startups**: `stripe, figma, anthropic, databricks, gitlab, elastic, doordash, robinhood` / `netflix, spotify, plaid, brex, ramp, mistral`.
- **`sample` is enabled by default** and its 5 fabricated postings contaminate facets, analytics averages, funnel counts, geography and the "best source" insight.

**Realistic volume for the actual user (Porto, senior full-stack .NET + Angular), per run:** Greenhouse 0–3 (almost none run a .NET stack), RemoteOK 1–2 after the phrase gate, HN 1 if the right thread is found, Lever 0 (not enabled), Sample 5 (fake). **The discovery layer is, for this user, non-functional.** There is no Portuguese or European source of any kind.

## 2.5 Normalize / dedupe

`normalize()` is pure and idempotent as documented. Three real defects:

- **The technology vocabulary is 57 hardcoded English entries.** `.NET` and `C#` are present; Blazor, Entity Framework, MAUI, Dapper, SignalR, Nx, Vite, Bun, dbt, Snowflake are not. Non-English postings detect nothing, so `_skill_dimension` falls to the 0.5 neutral midpoint and **every Portuguese or German posting gets an identical, meaningless 19/38 on the dominant dimension.**
- **The salary regex produces confident false positives.** Reproduced: `"we process 30,000 - 90,000 requests"` → salary 30 000–90 000. `"We serve 20.000 to 50.000 customers"` → 20 000–50 000. The `high < 10000` guard catches versions and headcounts but nothing in the 10k–200k band, which is exactly where customer counts and request rates live. The function's own docstring says *"A wrong salary is worse than no salary, because the user filters on it"* — and then ships exactly that.
- `detect_remote_type` checks hybrid before remote, so "fully remote, occasional hybrid days" classifies as HYBRID. `split_location("Berlin")` returns `city="", country="Berlin"`, poisoning the geography analytic.

Dedupe is three widening steps and is mostly well designed — duplicates are retained with `duplicate_of_id` rather than discarded, which correctly limits the blast radius of a false positive. But `titles_match` sorts the words alphabetically before `SequenceMatcher`, which destroys the information that distinguishes near-identical titles. Measured: `Senior Software Engineer` vs `Senior Software Engineer II` → **0.941, merged** — different level, different pay band, one row. And step 3 hydrates full ORM rows including `description` and `raw_payload` for every company-ish `ilike` match, once per incoming job, inside a per-job `flush` loop.

## 2.6 Scoring

```python
WEIGHTS = {"skills": 38.0, "role": 22.0, "seniority": 14.0,
           "location": 16.0, "salary": 6.0, "freshness": 4.0}   # = 100.0
```

The arithmetic is real, the breakdown is exposed to the UI, and the ±8 clamp is correctly implemented. Three qualifications:

1. **Not time-stable** — `utcnow()` in the freshness dimension.
2. **The default path is not deterministic** — `use_model=True` everywhere, Ollama at `temperature=0.1` with no seed.
3. **Scores are never invalidated.** `job_scores.profile_version` is recorded and `PUT /profile` bumps `candidate.profile_version` — and **nothing ever compares them.** After the user edits their skills every existing score is stale, still displayed, and still driving the automation filter.

Also: the breakdown has 6 keys deterministic, 7 hybrid. `test_units.py` asserts exactly 6; `smoke_workflow.py:166` asserts `>= 6`. Two tests, two contracts.

## 2.7 Automation

**There is no scheduler.** `AutomationConfig.schedule_cron` is stored, exposed in both schemas, and read by nothing — 3 repo-wide references, all declarations. `POST /automation/start` sets `enabled = True` and returns. `config.enabled` is consulted only by `blocking_reason()`, which is consulted only for non-manual triggers, and **no non-manual trigger exists**. The `trigger` column has exactly one possible value: `"manual"`.

The run itself is a bare `asyncio.create_task` on the API's own event loop (`api/automation.py:101`, reaching into `engine._task` — the router mutating engine internals). It can issue up to 400 scoring calls and 50 document calls sequentially at 180s each, with no wall-clock budget, while every other route contends for the same loop.

**Dead configuration the user can set and the code ignores:** `daily_discovery_limit` (declared, never read), `min_score_to_submit` (declared, snapshotted, never compared), `excluded_keywords`, `excluded_industries`, `Job.deadline`, `Document.structured`. Six user-facing guard rails that do nothing. **In a product whose value proposition is restraint, this is the most dangerous class of dead code in the repository.**

**No retries anywhere.** A stage that throws aborts the run to `FAILED`.

**The kill switch is real and correct** — `emergency_stop` is DB-backed, re-read at every checkpoint including inside the per-job loops, blocks new runs at the API, and forces `enabled=False`. Keep this exactly as it is.

**It does not survive restart, and it corrupts state.** The engine is in-memory; on process exit the task dies mid-stage; on restart `is_running` reports `False` while the `automation_runs` row stays `status="running"`, `finished_at=NULL` forever. There is no startup reconciliation.

## 2.8 Truthfulness — the most important finding in this document

`check_document` does exactly three things: fail on empty text, `_check_years`, `_check_technologies`.

- The employer / institution / certification allowlist is **built at `:58-65` and never referenced again**.
- `_check_technologies` only examines text between a Markdown `Skills`/`Technologies`/`Tech Stack` heading and the next heading. **If that heading is absent it returns silently.**
- `_check_years` **returns early and checks nothing if the profile declares no years.**

Reproduced, against the real extraction logic:

```markdown
## Experience
### Lead Architect - Google
*2021 - 2025*
- Led the Kubernetes migration for 40 microservices, cutting AWS spend 45%.
- Holds an AWS Solutions Architect Professional certification.
- BSc from MIT.

## Skills
Angular, TypeScript
```
→ `invented tech: []`, `invented years: []`, **`passed = True`**.

**Cover letters are checked for nothing at all.** A letter has no Markdown Skills heading, so `_check_technologies` returns immediately; with an empty year set `_check_years` returns too. Confirmed: *"I led the Kubernetes migration at Google, where I was Principal Architect, and I hold an AWS Solutions Architect certification from MIT"* → passes. Cover letters are precisely where an LLM invents employers, metrics and enthusiasm, and they receive zero verification.

The real guarantee this product currently delivers is different, and it is worth stating plainly: **the template path is incapable of fabrication because it is pure string formatting over profile fields.** Everything protective in this product lives in `render_master_cv` and `render_cover_letter_template`. The moment the model path succeeds, the only thing between the user and a fabricated CV is a prompt instruction.

One more asymmetry: `documents.py:174` rejects a model CV shorter than 40% of the master and falls back to the template. There is **no upper bound** — a model that doubles the CV with invented content is accepted.

## 2.9 Documents

Markdown is canonical. Export offers `md`, `txt` (regex-stripped) and `html` (a hand-rolled six-regex converter intended for browser print-to-PDF).

**There is no PDF writer and no DOCX writer.** `backend/requirements.txt` is six lines: `fastapi, uvicorn, sqlalchemy, pydantic, httpx, python-multipart`. Zero hits for `reportlab`, `weasyprint`, `fpdf`, `python-docx`, `docxtpl`, `pandoc` anywhere in the repository. **A user cannot attach a CV to an application from this product.** For a job-application tool where every ATS expects PDF or DOCX, this is the single biggest functional gap after discovery.

The `generated_by` honesty (`template` vs `model`) is real and surfaced in the UI — genuinely good. But the fallback is **silent**: `except (LLMUnavailable, Exception)` swallows every error including real bugs, and the user is never told the model timed out after three minutes.

**Version history is the best-implemented subsystem in the backend.** `lineage_key`, `is_current` flipping, monotonic version, `/versions`, `/restore`, `DELETE` refusing the current version, user edits creating a new version rather than mutating. Keep all of it.

## 2.10 Email

| Piece | Status |
|---|---|
| 3 models, 9 routes, 3 seeded templates, follow-up detection, prefilled drafts | Implemented |
| Credential rejection (the API refuses a payload carrying a password) | Implemented and correct — keep |
| **SMTP send** | **Stub.** `POST /drafts/{id}/send` flips `folder="sent"`, `status="sent"`, `sent_at=utcnow()` and returns `"Sent."` **No message is transmitted.** |
| **IMAP receive** | **Absent.** `folder="inbox"` is queryable; nothing ever writes one. |
| **Gmail OAuth** | **Absent.** `oauth_scopes` is a column. No auth URL, no token exchange, no refresh, no client. |
| **Classification** | **Absent.** `classification` is a column and an index; nothing computes it. |
| `is_connected` | **Unreachable.** Hardcoded `False` at creation; no endpoint sets it. |

`grep` across `backend/app`: `smtplib` → 0, `imaplib` → 0, `email.mime` → 0, OAuth → 0.

The whole subsystem is a schema, a form, and `README.md` listing *"Follow up on applications that have gone unanswered, with the draft prepared"* as a shipped feature — true only in the sense that a draft is prepared and can never be sent.

## 2.11 LLM integration

| Aspect | Finding |
|---|---|
| Endpoint / model | `POST /api/chat` on `127.0.0.1:11434`, model `qwen3-coder:30b-32k`. **The `Modelfile` says `FROM qwen3-coder:30b` and names no output tag** — nothing in the repo creates `qwen3-coder:30b-32k`. The default model is unavailable until the user runs an `ollama create` documented nowhere. A 30B model also implies ~20 GB of VRAM/RAM. |
| Timeout | 180s. Very long to hold inside a request. |
| Streaming | **Disabled** (`"stream": False`). A 3-minute generation gives the UI no progress at all. |
| Retries | **None.** One attempt. |
| **Caching** | **None whatsoever.** No memoisation, no content-hash key, no persisted prompt/response store. Re-scoring an unchanged job calls the model again. There is no dedupe of identical prompts across the 400-job loop. |
| Concurrency | All calls sequential by construction. No `gather`, no semaphore, no batching. |
| Untrusted fencing | **Excellent.** Preamble + fence + fence-token stripping, applied at all four sites. |
| Prompt construction | The profile is interpolated via Python `repr` of a dict (`f"{profile}"`) — the model sees Python literal syntax rather than JSON. Ugly and token-wasteful. |
| Ollama absent | **Handled well.** `available=False` with a clear reason; separately detects "running but model not pulled" and lists what *is* available; `/api/health` degrades rather than fails; every caller falls back with honest labelling. |

The degradation story is the strongest part of this integration. The absence of caching is the most expensive omission in the entire backend.

## 2.12 Tests

61 assertions and 43 smoke checks over ~4,700 lines, concentrated on the ~600 lines that are easiest to test and that fail most safely. Neither file is pytest — both are linear scripts with shared mutable state; `pytest tests/test_units.py` would collect **zero tests** while executing the file at import and potentially `sys.exit(1)`ing during collection. In `smoke_workflow.py`, a failure at `check("package prepares")` triggers an early `return`, so **20 of the 43 checks are conditional**.

**Zero coverage** of: every `api/` module (no `TestClient`, no route test), every `sources/` module (no fixture, no recorded response — including the silent `return_exceptions` drop and the HN relevance bug), `llm/` (the greedy `extract_json` regex and the fence-stripping are untested), the ±8 clamp itself, `services/automation.py` (424 lines, the most stateful module), `store_document` versioning, all 8 analytics functions, and `cv_import._read_pdf`/`_read_docx` — the binary parsers, which are the highest-risk code in the repository.

## 2.13 Frontend and Tauri

**Frontend strengths, which are real:** zero `any`, zero `@ts-ignore`, `types.ts` diffed field-by-field against the Pydantic schemas with correct optionality; a hand-built design system whose `tokens.css` is a **verbatim, pixel-verified transcription of `DESIGN.md`** (I sampled `mock.png` — `--status-pipeline #6953d3` and `--status-success #47bb68` are exact matches); an `Icon.tsx` of 49 glyphs genuinely on the 24px/1.5px spec; and **the best zero-data states in any project of this size** — the pipeline renders as seven greyed stage rows so the user learns the shape before they have one, the automation card becomes a numbered five-step explanation of what a run does, and every empty state branches its copy *and its primary action* on whether filters are active.

**Frontend failures:**

- **Neither font is shipped.** `DESIGN.md` §2 mandates Inter and JetBrains Mono *"shipped with the app, never fetched at runtime"*. No `.woff2`, no `.ttf`, no `@font-face` anywhere. The product renders in Segoe UI / Consolas fallbacks. **Every weight (450/550/620/640/650), size and letter-spacing value in the spec was tuned for a variable font that is not present — so the shipped typography is nobody's design.**
- **107 off-scale spacing values, 49% of all inline spacing.** The `10px`, `7px` and `6px` clusters are systemic — `components.css` itself sets `gap: 10px` on `.rail-brand`, `.rail-item`, `.rail-user`, `.notice`, `.toast`. The 4px grid the spec is built on is not what the product is built on. Plus ≥9 type sizes outside the §2 table.
- **`AnalyticsView` converts server errors into empty states.** Seven of eight requests have a `loading` branch and no `error` branch; `data ?? []` turns a 500 into *"The funnel fills in once jobs are discovered and scored."* **A server error presented to the user as "you have no data yet"** — a head-on violation of `CLAUDE.md` rule 4.
- **No ErrorBoundary anywhere**, combined with `navigate(insight.action!.view as never)` at `DashboardView.tsx:441` which casts a backend string past the `ViewId` check — an unmapped value makes `<View />` throw and blanks the window to white. A `VIEW_IDS` guard already exists at `AppState.tsx:75` and is not reused.
- **The command bar gets stuck.** Polling calls the view's own `reload()`, never `invalidate()`; the Shell's automation state refreshes only on `revision`; `navigate()` does not bump it. When a run finishes on its own the "Run in progress" badge and the disabled Run button **stay stuck indefinitely**.
- **The Kanban is keyboard-inoperable for its primary function** — HTML5 drag only, no stage selector in the detail modal.
- **Contrast fails, measured:** `--text-muted #63718c` on `--surface-1` = **3.51:1** at 11.5px, and it carries every timestamp, count, hint, placeholder and column label in the product. `--status-pipeline` on its tint = **2.89:1** — the colour of "Discovered" and "Interested", the two most common states. `--accent` as link text = **2.91:1**. The focus ring is ~2.9:1. `tokens.css:45-46` proves the author diagnosed this exact failure and fixed exactly one badge.
- **The density claim is false.** `DESIGN.md` §10 opens with *"let density carry the premium feel"*. A `JobRow` is ~86px tall — **10 postings per screen**.
- **Seven external-open call sites use `window.open`.** `@tauri-apps/plugin-opener` is permitted and **never imported** (`grep @tauri-apps` in `frontend/src` → nothing). "Open posting", "Download Markdown" and "Print view" are dead in a packaged build — and `exportUrl` is the **only** route out of the app for a generated CV.

**Tauri shell:**

- **`backend::start()` blocks up to 90s before `window.show()`**, and the window is `visible: false`. On any backend failure the user double-clicks and gets **a minute and a half of no window at all**.
- **`stdout`/`stderr` are `Stdio::null()`** and `eprintln!` under `windows_subsystem = "windows"` goes nowhere. There is no log file. **A packaged failure produces zero diagnostic output anywhere on the machine.**
- **`port_in_use()` is a bare 300ms TCP connect** that never probes `/api/health`. Any unrelated listener on 8756 is silently adopted as the Job Hunter API.
- **The API address is injected by `window.eval` at `PageLoadEvent::Started`**, while `const BASE = resolveBase()` runs at module-eval time. The ordering is not guaranteed; the correct mechanism is `initialization_script()`. Whenever the port is reassigned, every request goes to the wrong place with no diagnostic. This also forces `'unsafe-inline'` in `script-src`.
- **No supervision after start** — no health monitoring, no restart, no crash detection.
- **`python_command()` probes `backend/runtime/python.exe` and `backend/.venv/`. Neither is produced by any build step and neither is in `bundle.resources`.** The bare `"python"` fallback is always taken.
- **No updater, no code signing.**
- Three of five granted permissions and one of three plugins are dead weight. `plugins.shell.open: true` is Tauri **v1** syntax and is inert under v2.

## 2.14 What is genuinely good and must be preserved

Do not let the length of the defect list obscure this. These are real assets:

1. **The untrusted-input fence** (`llm/base.py:44-60`) — better than two of the three reference projects.
2. **The ±8 clamp** — correct coercion, symmetric bound, re-bound to range.
3. **The emergency stop** — DB-backed, re-read mid-run, blocks new runs.
4. **`can_submit` as an honest per-source capability** that is `False` almost everywhere.
5. **The analytics honesty layer** — numerator/denominator/`low_confidence` on every rate.
6. **Document version history** — lineage, `is_current`, restore, edits-as-new-versions.
7. **The zero-data / first-run states** in the renderer.
8. **`tokens.css`** — a verified transcription of a design spec, which almost no project achieves.
9. **The Ollama degradation path** — honest labelling all the way to the UI.
10. **The rendered honesty vocabulary** — "Scored without the model", "Also on 3 other boards", "No documented submission mechanism", "This form deliberately has no password field", and the Settings "what this will not do" cards.

---

# 3. Three-repository comparison

## 3.1 `ai-job-hunter-app` (saeedkolivand, Apache-2.0, v0.153.2)

**Purpose:** a local-first Tauri 2 desktop app that finds, ranks and tailors — and explicitly **stops short of applying**.

**Stack:** Tauri 2 + Rust core (all business logic), React 19 + TanStack Router/Query + Zustand + Tailwind v4, Vite 8 + Turborepo + pnpm workspaces, SQLite via rusqlite (WAL, `PRAGMA user_version` migrations in code), FTS5 + in-process cosine + RRF fusion, Typst 0.15.1 for PDF, docx-rs for DOCX, IMAP + `mail-parser`, Zod schemas in `packages/shared` generating Rust structs. **No server, no sidecar, no second process.**

**Strongest things, and why they matter to us:**

1. **A registry-driven `Scraper` trait with honest capability flags** — `requires_company`, `needs_keys`, `supports_location`, `supports_work_type`, `is_all_remote`. The engine *compensates* (conservative central location post-filter that drops only rows whose own location clearly mismatches, never remote or unknown) and *explains* (`skipped: "needs-company"`, `notes: ["location-filtered:7"]`). Adding a board is one module plus one line, with a bidirectional registry-parity test and a vacuity guard.
2. **`BoardScrapeSummary`** — `{board, count, error, skipped, truncated, notes[], health}` folded onto every result, plus a cross-run `board_health.db` so the UI can distinguish "found nothing today" from "broken since Tuesday".
3. **Deterministic anti-fabrication with a refuse-to-save gate.** Quote grounding in Rust (non-verbatim quotes are *dropped, never repaired*); Criticals a model structurally cannot emit; each pipeline stage re-anchors to the **source** résumé rather than to the previous stage's output — *"a chain where each step trusted the last is exactly how a single early fabrication becomes a confident finished document"*; `SaveVerdict::Refused` blocks export until each flagged claim gets a human verdict; a CI eval harness over planted-defect fixtures.
4. **Cost architecture that fails closed** — the output cap (`amount`) is separate from the upstream spend target (`provider_amount: Option<u32>`), where `None` means *no spend*, and scheduled runs **always** pass `None`. `retries: 0` on every metered fetch, with the reasoning written down: *"a 429 from a metered API is the over-quota signal, so retrying answers 'you are out of quota' by spending more of it."*
5. **Clock-anchored scheduling with deterministic per-record jitter.** Due-ness computed against `last_occurrence_ms`, which gives crash catch-up for free without double-firing; FNV-1a over the record id into a 10-minute window so every default-9am install does not hit the same third-party API in the same minute; exactly one retry after 12 minutes, outcome deliberately not re-checked so it is *"structurally impossible to storm"*; pause cancels the retry.

**Weakest:** it stops exactly where the pain is (12 ATS **read** adapters, 0 write adapters; autofill cannot reach an iframe, which is where every embedded ATS form lives; 7 contact fields only). Source coverage is fragile and largely BYO-key — Indeed, Glassdoor, Xing, StepStone and Workday are all *retired* for anti-bot, and `SCRAPING_ENDPOINTS.md` opens by admitting it is stale with 7 boards marked unverified. A shipped correctness bug with tests deliberately written to stay red (`pipeline_runs.db` has no crash-recovery sweep, so a killed run permanently locks that posting). And a surface-area-to-maintainer ratio that is unsustainable: 25 boards, 5 providers, 4 CLI agents, 16 templates, a Typst engine, a DOCX backend, an MV3 extension for two browsers, a Next.js site, an MCP server, and ~1.5 MB of Rust test files.

## 3.2 `ApplyPilot` (ibarrajo fork, AGPL-3.0, v0.2/0.3)

**Purpose:** a fully autonomous 7-stage pipeline that actually submits — `discover → enrich → score → tailor → cover → pdf → apply → track`.

**Stack:** Python 3.11+, Typer + Rich CLI, SQLite with no ORM, patchright (stealth Playwright fork) for scraping, real Chrome over CDP for applying, `claude` CLI subprocess as the form-filling agent, Gmail via a pinned third-party MCP server, an MV3 extension, hand-rolled `http.server` instances per worker.

**Strongest things worth taking:**

1. **`discovery/ats_common.py`** — Greenhouse, Lever and Ashby reduced to one `scrape_one_employer(slug, meta) -> (jobs, error)` each; `run_ats_crawl()` does the rest; employer registries are YAML, not code. Adding an employer is a 3-line YAML edit.
2. **Embedded-ATS URL canonicalization with organic slug learning.** `careers.databricks.com/...?gh_jid=N` is rewritten at insert time to `job-boards.greenhouse.io/databricks/jobs/N`, because *"iframe forms are 2–3× slower to fill."* Slugs come from a curated map **plus a runtime cache learned by scraping iframe `src` attributes** — so every aggregator-discovered listing on an unknown host teaches the map without a code change. A one-time backfill rewrote 405 URLs.
3. **A deterministic regex pre-filter before any paid scoring.** `_check_ineligible()` matches non-US geography and off-target roles in title/location/first 6000 chars and returns `score=2` **with no LLM call** — *"patterns validated 2026-04-23 against 5,938 historical scored jobs"*, tuned so no pattern rejects more than 1–2 jobs that scored ≥8.
4. **The Q&A knowledge base.** `qa_knowledge` keyed on a normalised `question_key`, ranked by `source` (`human > profile > agent`) and `outcome`, injected into every future application, escalated to the user in the terminal when a required question is unknown, YAML-exportable. **This is the genuinely compounding asset in the whole reference set.**
5. **Structured-JSON LLM output with a code-assembled document.** *"The LLM returns structured JSON, code assembles the final text. Header (name, contact) is always code-injected, never LLM-generated. Each retry starts a fresh conversation to avoid apologetic spirals."*
6. **The cover-letter overhaul** is a model of audit-measure-fix: 3,823 generated letters analysed → median 138 words against a 300–400 target, 87 letters pitching LinkedIn as the employer, 62% containing the prompt's own example sentence, 28% containing "aligns with" → five targeted fixes including a `display_company(job)` helper so the job board is never presented as the employer, a stem-regex error tier that forces regeneration, and **refusing to ship a failing letter** (rejected drafts go to `_CL_rejected.txt` and the job parks as `cover_failed`).

**Weakest, and these are disqualifying for us:** the truthfulness guarantees are overstated to the point of dishonesty — the programmatic fabrication check is an **11-string watchlist** (`c#, c++, rust, ruby, swift, scala, matlab, rails, svelte, pmp, scrum master`), the LLM judge is explicitly instructed *"the goal is to get interviews, not to be a perfect fact-checker… allow up to 3 minor stretches… adding any LEARNABLE skill given their existing stack is a MINOR STRETCH"*, the judge is skipped on a clean first pass and **overridden on the last attempt** (`log.warning("Judge failed on final attempt, accepting anyway")`), and the project's own note records *"KNOWN GAP: validator can't catch fabricated metrics/facts, only fabricated tools."* The apply prompt then instructs the agent to answer **YES** to any same-domain tool question. Site passwords are stored in plaintext SQLite and inlined verbatim into prompts sent to external LLM providers. `scorer.SCORE_PROMPT_TEMPLATE` hardcodes *"The candidate is US-based (Seattle, WA)"* and a specific Go/Kotlin stack. `_infer_result_from_output` marks a job `applied` when the transcript merely **contains** `"thank you for applying"`. `DEFAULTS["apply_timeout"]` is defined and referenced nowhere, so a looping agent runs unbounded.

## 3.3 `mr-jobs` (humancto, MIT)

**Purpose:** a self-hosted single-user autopilot: discover → score → tailor → auto-fill → track, with a FastAPI dashboard.

**Stack:** Python 3.11, FastAPI + Jinja2 + WebSocket, Alpine.js + Tailwind + Chart.js **all from CDN with no build step**, Playwright, APScheduler, SQLite with stdlib `sqlite3`, `claude -p` as a subprocess, stdlib `imaplib`.

**Strongest things worth taking:**

1. **`utils/url_resolver.py`** — six ordered strategies turning an aggregator listing URL into a real ATS application form (is-it-already-ATS → 50-entry company→ATS table → HN comment text mining → HTTP redirect follow → apply-link extraction → careers fallback), each labelled in the returned `resolution` field. 50 unit tests. **It solves the hard problem nobody else bothers with**, and the provenance field makes every failure debuggable.
2. **Accessibility-tree-driven form analysis.** `page.accessibility.snapshot()` plus a structured JS element walk producing label, xpath, options, `required`, visibility — ~8 KB vs ~14 KB of `innerHTML`, far more stable across redesigns, and the only shape that fits a small local model's context.
3. **The privacy boundary, stated as a one-line invariant:** *"Profile data is used directly — it is NEVER sent through Claude. Claude only identifies WHERE to fill, not WHAT."* (Violated by their own two fallback adapters, which is itself the lesson: state the boundary, then enforce it everywhere.)
4. **A three-tier answer cascade** — regex → profile field → LLM. ~80% of ATS questions are the same 11 questions; answering them from a table is faster, free, deterministic and auditable.
5. **Follow-up date + ghost detection + a hash-based ignore list that survives purges.** `follow_up_date = applied_at + 7d` set automatically, `get_ghost_alerts(days=14)`, both surfaced in an ACTION REQUIRED card. **The highest value per line of code in the entire reference set**, and it is pure SQL.
6. **Per-source `try/except` isolation written down as a numbered invariant** in `CLAUDE.md`, so it survives future contributors.

**Weakest:** the pluggable-LLM system is documented in a four-backend table and `_BACKENDS` contains exactly `{"claude_cli": ClaudeCLIBackend}` — a user configuring Ollama for privacy silently gets cloud Claude and a one-line warning on stdout. The server defaults to `0.0.0.0` with **zero auth on ~45 endpoints**, and `GET /api/profile` returns the IMAP app password in cleartext while `POST /api/yolo {"dry_run": false, "continuous": true}` starts unattended live applications. **Zero CAPTCHA handling** in a system that advertises unattended operation. Email auto-mutates job status on a fuzzy substring company match with no confirmation and no undo — "my Block application got marked rejected because a recruiter from Blockchain Inc emailed me." The tailored resume **produces no document** — it is advisory JSON the user retypes. `dashboard/server.py` is 1,635 lines containing a **fourth copy** of the core pipeline, with a live `NameError` scoping bug.

## 3.4 What the three teach us, collectively

| Lesson | Taught by |
|---|---|
| **Auto-apply is not viable inside an ethical boundary.** One team built it and deleted it; one team can only do it with paid CAPTCHA solving and fingerprint evasion; one team ships it with no CAPTCHA handling at all. | all three |
| **Company-scoped ATS JSON APIs are the durable discovery substrate.** All three converged on Greenhouse + Lever + Ashby as clean, keyless, full-description, legally unambiguous. | all three |
| **The cold-start problem is "which slug?", and the answer is a seed table plus passive harvesting.** | ai-job-hunter-app, ApplyPilot |
| **Truthfulness must be structural, not prompted.** ai-job-hunter-app made it a type; ApplyPilot made it a prompt plus an 11-string list and its own docs admit it fails; mr-jobs made it one sentence in a prompt and claims it as a system property in the README. | contrast of all three |
| **Deterministic filtering before inference is the single biggest cost lever.** | ApplyPilot (regexes validated on 5,938 rows) |
| **Answered screening questions are the compounding asset.** | ApplyPilot |
| **Per-source result objects with skip reasons and health are what make discovery trustworthy.** | ai-job-hunter-app |
| **Follow-up and ghost detection are the cheapest high-value features in the category.** | mr-jobs |
| **Documenting a feature you did not build is the most common failure mode in this category — and Job Hunter has it too.** | all three, and us |

---

# 4. Feature comparison matrix

Legend: **●** full · **◐** partial · **○** absent · **✕** deliberately rejected

| Capability | Job Hunter (now) | ai-job-hunter-app | ApplyPilot | mr-jobs | Job Hunter (target) |
|---|---|---|---|---|---|
| **Distribution** |
| Desktop app | ● Tauri 2 | ● Tauri 2 | ○ CLI | ○ self-host web | ● Tauri 2 |
| Installable without a dev env | ○ | ● | ○ | ○ | ● |
| Code-signed installer | ○ | ● | n/a | n/a | ◐ (V1.5) |
| Auto-update | ○ | ● | ○ | ○ | ● V1 |
| Runs fully offline | ◐ | ◐ | ○ | ○ | ● |
| **Discovery** |
| Greenhouse / Lever / Ashby / Workable | ◐ GH+Lever | ● + 9 more ATS | ● 3 | ◐ GH+Lever | ● 6 |
| European sources | ○ | ◐ DE-focused | ○ | ○ | ● |
| Portuguese sources | ○ | ○ | ○ | ○ | ● |
| Keyed aggregator (Adzuna/Jooble) | ○ | ● | ○ | ◐ Adzuna | ● |
| Aggregator scraping (Indeed/LinkedIn) | ✕ | ✕ retired | ● ToS-violating | ● ToS-violating | ✕ |
| Company→ATS slug seed + harvesting | ○ | ● | ● | ◐ 50-entry map | ● |
| Per-source result object w/ skip reasons | ◐ | ● | ○ | ◐ | ● |
| Cross-run source health | ○ | ● | ○ | ○ | ● |
| Rate limiting | ○ | ● per-host | ◐ | ○ | ● |
| Retry / backoff | ○ | ● | ◐ | ○ | ● |
| **Matching** |
| Deterministic score w/ visible breakdown | ● | ● | ○ | ○ | ● |
| Bounded LLM adjustment | ● ±8 | ◐ rerank | ○ | ○ | ● ±8 |
| Cheap pre-filter before inference | ○ | ● | ● | ◐ | ● |
| Score invalidation on profile change | ○ | ● formula_version | ○ | ○ | ● |
| Semantic / embedding search | ○ | ● FTS5+dense+RRF | ○ | ○ | ◐ V2 |
| Ghost-job / trust signal | ○ | ● | ○ | ○ | ◐ V1.5 |
| **Documents** |
| Master CV from structured profile | ● | ● | ● | ○ | ● |
| Tailored CV | ● MD only | ● | ● | ◐ JSON only | ● |
| Cover letter | ● MD only | ● | ● | ◐ JSON only | ● |
| **PDF output** | **○** | ● Typst | ● Chromium | **○** | ● |
| **DOCX output** | **○** | ● docx-rs | ● python-docx | **○** | ● |
| Version history + restore | ● | ◐ | ○ | ○ | ● |
| Structural anti-fabrication | **○** | ● | ○ | ○ | ● |
| Refuse-to-export on a Critical | ○ | ● | ◐ letters only | ○ | ● |
| Cover letter validated | **○** | ● | ● | ○ | ● |
| **Applying** |
| Auto-submit | ○ | ✕ deleted | ● ToS-violating | ● no CAPTCHA | ✕ by design |
| Prepared ACTION_REQUIRED package | ◐ unreachable | ● | ● | ◐ | ● |
| Screening-answer generation | ○ | ● drafts | ● | ● | ● |
| **Reusable answer knowledge base** | ○ | ○ | ● | ◐ regex table | ● |
| One-click open employer form | ◐ broken | ● | ● | ● | ● |
| Copy-to-clipboard answer pack | ○ | ● | ○ | ○ | ● |
| **Tracking** |
| Pipeline board | ● | ● | ◐ HTML | ◐ table | ● |
| State machine w/ legal transitions | ○ | ● | ● 23 states | ○ | ● |
| Append-only transition audit | ◐ JSON blob | ● | ● table | ○ | ● table |
| Follow-up reminders | ◐ | ● | ● | ● | ● |
| Ghost detection | ○ | ● | ● | ● | ● |
| **Email** |
| Send | ○ stub | ✕ none | ◐ agent | ○ | ◐ V2 |
| Inbox sync | ○ | ● IMAP | ● Gmail MCP | ● imaplib | ● V1.5 |
| OAuth | ○ | ○ app password | ● user OAuth | ○ app password | ● OAuth only |
| Reply classification | ○ | ● 4-way | ● LLM | ◐ keywords | ● |
| Auto status advance | ○ | ● gated, unconfirmed | ● | ● **ungated — dangerous** | ● suggest-then-confirm |
| **Automation** |
| Scheduler | **○** | ● clock-anchored+jitter | ○ | ● APScheduler | ● |
| Survives restart | ○ | ● catch-up | n/a | ◐ | ● |
| Emergency stop | ● | ● | ● | ● | ● |
| Daily limits enforced | ◐ | ● | ● | ● | ● |
| Retries | ○ | ● exactly one | ◐ | ○ | ● |
| Runs out of the API process | ○ | n/a (in-proc Rust) | n/a | ○ | ● |
| **Platform** |
| DB migrations | **○** | ● user_version | ◐ additive | ◐ additive | ● |
| LLM response caching | **○** | ● stage kv_cache | ○ | ◐ unused | ● |
| Structured logs, user-visible | ○ | ● | ● | ● | ● |
| Secrets in OS credential store | ◐ by design | ● keychain | ✕ plaintext | ✕ plaintext | ● |
| Untrusted-input fencing | ● | ● | ◐ | ○ | ● |
| Backup / export / factory reset | ○ | ● | ○ | ◐ purge | ● V1.5 |
| **UI** |
| Design system with tokens | ● | ● + ESLint-enforced | n/a | ○ | ● + enforced |
| Fonts shipped | **○** | ● | n/a | ○ CDN | ● |
| Command palette | ○ | ● | n/a | ○ | ● |
| Keyboard-operable pipeline | ○ | ● | n/a | ○ | ● |
| WCAG AA contrast | ○ measured fail | ● axe+Lighthouse CI | n/a | ○ | ● |
| Zero-data states | ● **best of set** | ● | ◐ | ◐ wizard | ● |

---

# 5. Current product gaps, prioritised

## P0 — blocking. The product cannot ship or cannot be honest without these.

| # | Gap | Evidence | Consequence |
|---|---|---|---|
| **P0-1** | **No Python runtime or dependencies bundled.** `bundle.resources` ships `backend/app/**` and `requirements.txt`; `python_command()` probes `backend/runtime/` and `.venv/`, **neither of which any build step produces**; there is no `pip install` anywhere in the repository. | `tauri.conf.json:44-47`, `backend.rs:109-124` | On a clean Windows 11 machine, `python` resolves to the Microsoft Store alias stub, `spawn()` **succeeds**, the Store opens, and the shell believes it started a backend. The `.exe` is a developer-machine artifact with an installer around it. |
| **P0-2** | **Window hidden for up to 90 seconds on failure, and zero diagnostics.** `start()` blocks before `window.show()`; the window is `visible: false`; child stdout/stderr are `Stdio::null()`; `eprintln!` under `windows_subsystem = "windows"` goes nowhere; no log file. | `main.rs:52-61`, `backend.rs:161-162`, `tauri.conf.json:24` | The user double-clicks and stares at an empty desktop for 90s, then gets a window where every panel says the backend is not responding — and **nothing on the machine records why**. Most first-time users abandon here. |
| **P0-3** | **No PDF and no DOCX writer.** Six dependencies total; zero hits for any document library. | `backend/requirements.txt`, `api/documents.py:169-243` | The user cannot attach a CV to any application. The product's entire output is unusable for its stated purpose. |
| **P0-4** | **Truthfulness validation does not validate.** The employer/institution/certification allowlist is built and never used; the technology check is skipped entirely when there is no Markdown Skills heading; the year check disables itself on an empty profile; **cover letters are checked for nothing**. | `truthfulness.py:58-65, 81-82, 116-117` | `CLAUDE.md` rule 1 and the README's "it will not fabricate" are false. A user can send a CV naming an employer they never worked for, believing it was verified. This is the reputational risk of the entire product. |
| **P0-5** | **Discovery cannot find relevant jobs for the actual user.** No European or Portuguese source; default boards are 14 US startups; the keyword gate is a whole-phrase substring test; the technology vocabulary is 57 English entries with none of the .NET ecosystem. | `sources/*.py`, `base.py:183-192`, `normalize.py:18-74` | A first run for a Porto-based senior .NET/Angular developer yields 5 fabricated postings and a handful of irrelevant US remote roles. |
| **P0-6** | **The `sample` source is enabled by default** and injects 5 fabricated postings into the user's real job list, facets, analytics averages, funnel, geography and "best source" insight. | `sources/__init__.py:33`, `sample.py` | The product's own analytics are computed over fake data by default. Unforgivable in a product whose differentiator is honesty. |
| **P0-7** | **No database migrations.** `create_all` only. No version table, no Alembic. | `db/session.py:41-45` | The first schema change after the first user installs bricks their database with no downgrade path. This is the one defect that cannot be retrofitted. |

## P1 — critical. The product works but lies, breaks under real data, or cannot be operated.

| # | Gap | Evidence |
|---|---|---|
| P1-1 | **There is no scheduler.** `schedule_cron` is stored and read by nothing; `/automation/start` sets a boolean; `trigger` has one possible value. "Enable scheduled automation" enables nothing. | `automation.py:42`, `api/automation.py:106-114` |
| P1-2 | **The submission counter is structurally always zero.** `route_for_submission` cannot return `SUBMITTED`; `if stage == PipelineStage.SUBMITTED` is unreachable dead code. The dashboard, funnel and run summary report on a capability that does not exist. | `services/applications.py:179-223`, `automation.py:393-395` |
| P1-3 | **ACTION_REQUIRED is unreachable in the default configuration** because `dry_run` is checked first and defaults to `True`. | `services/applications.py:186-199`, `models/automation.py:21` |
| P1-4 | **Six configurable guard rails are dead.** `daily_discovery_limit`, `min_score_to_submit`, `excluded_keywords`, `excluded_industries`, `Job.deadline`, `Document.structured`. | `models/automation.py:26,28`, `models/candidate.py:62-63` |
| P1-5 | **The dashboard 500s** on `max(performance, key=lambda i: i["average_score"])` when any source has unscored jobs — i.e. after almost every discovery run. | `api/analytics.py:156` |
| P1-6 | **No LLM caching of any kind.** Re-scoring an unchanged job calls a 30B model again. | `llm/` (absence) |
| P1-7 | **Long-running work inside HTTP requests**, up to ~6 minutes, with `stream: False`, no `AbortController`, no timeout, and a 14px spinner as the entire UI representation. The backend even documents a per-document progress state that does not exist. | `api/applications.py:127-151, 136-137`; `api.ts:96-125` |
| P1-8 | **The automation run executes on the API's own event loop** with blocking SQLAlchemy, up to 450 sequential model calls, no wall-clock budget. | `api/automation.py:101` |
| P1-9 | **No startup reconciliation.** After a crash, `automation_runs` rows stay `status="running"` forever while `/state` reports idle. | `main.py:31-36` |
| P1-10 | **Scores are never invalidated** when the profile changes, yet they drive the automation filter. | `job_scores.profile_version` recorded, never compared |
| P1-11 | **Greenhouse and Lever silently discard per-board failures**; all 8 boards can 404 and the source reports success. | `greenhouse.py:52-54`, `lever.py:41-43` |
| P1-12 | **Salary false positives.** `"we process 30,000 - 90,000 requests"` → salary 30 000–90 000, feeding the score, the `min_salary` filter and the salary distribution. | `normalize.py:96-101, 163-193` |
| P1-13 | **Neither font is shipped.** Every typographic decision in `DESIGN.md` is unrealised. | `frontend/` (absence of any font file) |
| P1-14 | **`AnalyticsView` renders server errors as empty states** — `data ?? []` turns a 500 into "you have no data yet". Direct violation of `CLAUDE.md` rule 4. | `AnalyticsView.tsx:122,141,209,225,247` |
| P1-15 | **External opens and document export are dead in a packaged build.** Seven `window.open` call sites; `@tauri-apps/plugin-opener` permitted and never imported. `exportUrl` is the only route out of the app. | `grep @tauri-apps frontend/src` → nothing |
| P1-16 | **No ErrorBoundary**, plus `navigate(insight.action!.view as never)` casting a backend string past the `ViewId` check. A render exception blanks the window to white. | `main.tsx`, `DashboardView.tsx:441` |
| P1-17 | **The command bar's "Run in progress" badge gets permanently stuck** when a run finishes on its own. | `Shell.tsx:43,78` vs `DashboardView.tsx:60` |
| P1-18 | **Contrast failures across the product**: `--text-muted` 3.51:1 at 11.5px carries every timestamp and label; `--status-pipeline` 2.89:1; `--accent` as link text 2.91:1; focus ring ~2.9:1. | measured against `tokens.css` |
| P1-19 | **The Kanban is keyboard-inoperable** for moving a card — the app's central workflow. | `ApplicationsView.tsx:229-243` |
| P1-20 | **Email is a schema and a form.** `send_draft` marks a message sent and transmits nothing. `is_connected` can never become `True`. README lists it as shipped. | `api/email.py:148, 234-260` |

## P2 — important

Port adoption without a health probe (`backend.rs:62-68, 132-136`) · API address injected by `window.eval` instead of `initialization_script()` · no updater, no signing · N+1 on `/applications/board` and `/email/follow-ups` · unbounded pagination on `/automation/runs` · five endpoints taking raw `payload: dict` · no state machine on stage transitions · `titles_match` merging `Engineer` with `Engineer II` · HN using relevance instead of date ranking · no rate limiting or retry in any source · `PUT /profile` without `exclude_unset` blanking omitted fields · automation config saved on every keystroke (`AutomationView.tsx:302-343`) — clearing a field persists `0` as the daily limit · Kanban with no optimistic update, so the card snaps back for the whole round trip · Modal with no focus trap and no focus restoration; Escape bound on `window` so stacked modals all close · no `aria-live` anywhere, so every async outcome is silent to a screen reader · rail collapse overwriting the user's choice on every resize · `CompanyMark` showing an empty tile instead of the monogram on a broken logo · 107 off-scale spacing values and ≥9 off-table type sizes · `applications_submitted_today` using a UTC rather than local day boundary.

## P3 — nice to have

Dead code (`Sparkline`, `.arrive` keyframes, `--titlebar-height`, `.sr-only`, `Dashboard.activity`, `RunCancelled`, `_CAPITALISED_RUN`, the `backend_port`/`backend_ready` Tauri commands) · `tauri-plugin-shell` loaded with no permissions · `plugins.shell.open` in v1 syntax · `preserveAspectRatio="none"` stretching chart axis text · charts with `role="img"` and no `aria-label` · the `≤980` breakpoint being unreachable given `minWidth: 1024` · profile interpolated into prompts via Python `repr` · the `/prepare` route taking a job id among application-id siblings · `db/session.py:53` bare `except`.

---

# 6. Recommended final architecture

## 6.1 Keep the stack. Change three things about how it is assembled.

Tauri 2 + React + TypeScript + Vite, FastAPI + SQLAlchemy + SQLite + Pydantic, Ollama. All correct for a local-first, privacy-conscious Windows app. The three changes:

**(1) The backend becomes a sidecar, not a `python` invocation.**

Freeze `backend/` with PyInstaller into `job-hunter-backend.exe` and register it as a Tauri `externalBin` sidecar. This is the smallest change that closes P0-1, and `tauri-plugin-shell` is already a dependency. The alternative — embedding `python-build-standalone` under `backend/runtime/` plus a vendored `site-packages` — also works and `python_command()` already probes for exactly that path; it produces a larger installer but keeps the backend inspectable. **PO decision: PyInstaller sidecar.** It is one artefact, one signature, one version, and it removes the entire class of "the user's Python is wrong" failures.

**(2) Long work moves out of the request/response cycle onto a job queue.**

Introduce a single `jobs` concept in the backend (not job *postings* — background tasks) with a table `tasks(id, kind, status, progress, stage, payload, result, error, created_at, started_at, finished_at)` and a worker thread pool separate from the event loop. `POST /jobs/discover`, `/applications/{id}/prepare`, `/jobs/{id}/score` and `/profile/import` return `202 {task_id}` immediately. `GET /tasks/{id}` returns progress. The renderer polls, and every long operation gets a real progress representation.

This also makes every route handler `def` rather than `async def` so FastAPI offloads blocking SQLAlchemy to its threadpool — which fixes the event-loop contention at the same time.

**(3) The truthfulness guarantee becomes structural.**

See §9.3. The short version: **the LLM never writes a factual claim.** It returns structured JSON that *selects, orders and rephrases*; Python assembles the document from profile fields. This is ApplyPilot's best idea (`"Header is always code-injected, never LLM-generated"`) generalised to every fact in the document, plus ai-job-hunter-app's verbatim-quote grounding and refuse-to-export gate.

## 6.2 Target module map

```
backend/app/
  core/          config, paths, logging, credential store (Windows DPAPI/CredMan)
  db/            base, session, migrations/   ← Alembic, versioned, forward+down
  models/        as today + tasks, answers, source_health, companies
  schemas/       as today + task, answer, package
  llm/
    base.py      fencing, JSON extraction  (keep)
    ollama.py    + streaming, retry, semaphore
    cache.py     NEW — content-hash keyed, persisted in SQLite
    prompts/     NEW — one module per prompt, versioned, JSON-serialised profile
  sources/
    base.py      Source protocol + capability flags + SourceResult
    registry.py  the single registry; adding a source is one line
    ats/         greenhouse, lever, ashby, workable, smartrecruiters, recruitee,
                 personio, teamtailor      (company-scoped, keyless)
    boards/      remoteok, remotive, arbeitnow, hackernews, eures
    aggregators/ adzuna, jooble            (BYO-key, fail closed to empty)
    pt/          itjobs, landingjobs       (only if their ToS permits; see §10.4)
    companies.py NEW — company→(ats, slug) seed table + passive harvesting
    resolver.py  NEW — listing URL → canonical ATS application URL
  services/
    discovery, normalize, dedupe, scoring, documents, truthfulness,
    applications, automation, analytics, cv_import   (as today)
    render/      NEW — pdf.py (WeasyPrint or Typst CLI), docx.py (python-docx)
    answers.py   NEW — the answer knowledge base
    tasks.py     NEW — the background worker
    scheduler.py NEW — APScheduler, clock-anchored, jittered
    email/       NEW — oauth.py, gmail.py, classify.py   (V1.5)
  api/           as today + tasks.py, answers.py; every handler `def`, not `async def`
```

## 6.3 Data model changes

**Do not redesign the schema.** Eleven tables is roughly right. Add five, change six things.

**New tables:**

| Table | Purpose |
|---|---|
| `tasks` | background work: kind, status, progress 0–100, current stage, payload JSON, result JSON, error, timestamps. Replaces `asyncio.create_task` and makes every long operation observable and restart-recoverable. |
| `application_events` | the append-only transition audit, promoted out of `Application.stage_history` JSON: `application_id, from_stage, to_stage, at, reason, actor`. Makes "when did anything enter INTERVIEW" a SQL question, which every analytic currently wants and cannot ask. |
| `answers` | the knowledge base: `question_key` (normalised), `question_text`, `answer_text`, `field_type`, `source` (`human` \| `profile` \| `model`), `outcome`, `use_count`, `last_used_at`, `is_current`. ApplyPilot's single best idea. |
| `companies` | `name, normalised_name, domain, ats, slug, discovered_from, verified_at`. Seeds the ATS crawl and is grown passively from every ingested URL. |
| `source_health` | `source, board, last_ok_at, last_error_at, last_error, consecutive_failures, jobs_last_run`. Lets the UI say "broken since Tuesday" instead of "0 results". |

**Changes to existing tables:**

1. `job_technologies(job_id, technology)` — a real relation replacing the `LIKE '%"tech"%'` substring search. Index `(technology)`. This single change removes the two in-memory full-table facet scans and makes technology filtering correct.
2. Index `created_at` on `activity_logs`, `automation_runs`, `documents`, `email_messages`; index `jobs.salary_max`; composite index `documents(candidate_id, lineage_key, is_current)`.
3. Unique constraints: `email_accounts.address`, `email_templates.name`, `documents(lineage_key, version)`, and a one-row check on `automation_config`.
4. `job_scores` gains `formula_version` alongside `profile_version`, and **both are compared on read** — a score whose `profile_version` or `formula_version` is stale renders as "needs rescoring", never as current.
5. `documents` gains `pdf_path`, `docx_path`, `validation_verdict` (`clean` \| `warnings` \| `blocked`) and `validation_findings` JSON.
6. `applications` gains `answers_id` references into `answers`, and `Application.stage_history` is retired in favour of `application_events` (keep the column for one release, dual-write, then drop in a migration).

**Migrations:** Alembic, from now, with `alembic stamp head` on existing databases at first upgrade. Non-negotiable, and every day it is deferred costs more.

## 6.4 Process architecture

```
┌─ Job Hunter.exe (Tauri / Rust) ──────────────────────────────┐
│  · shows the window IMMEDIATELY with a startup state          │
│  · spawns job-hunter-backend.exe as a sidecar                 │
│  · pipes child stdout/stderr → %LOCALAPPDATA%\JobHunter\logs  │
│  · probes GET /api/health (not a bare TCP connect)            │
│  · supervises: restart once on crash, then surface the log    │
│  · injects the API address via initialization_script()        │
│  · custom 32px title bar, window-state persistence, updater   │
└───────────────────────────────────────────────────────────────┘
                              │ 127.0.0.1:<port>
┌─ job-hunter-backend.exe (PyInstaller) ───────────────────────┐
│  FastAPI  ── def handlers, offloaded to the threadpool        │
│  Worker   ── ThreadPoolExecutor(2), consumes `tasks`          │
│  Scheduler ─ APScheduler, clock-anchored, enqueues tasks      │
│  SQLite   ── WAL, Alembic-versioned, %LOCALAPPDATA%\JobHunter │
└───────────────────────────────────────────────────────────────┘
                              │ 127.0.0.1:11434
                        Ollama (optional, degrades honestly)
```

---

# 7. Recommended UX

## 7.1 Design direction: keep "Midnight Command"

`DESIGN.md` is a genuine asset — the tokens are pixel-verified against `mock.png`, and the rejected-clusters section shows the alternatives were actually considered. Keep the direction, keep the palette, keep the dark-only decision. What is missing is not colour. It is **hierarchy, density and desktop identity**.

The current build reads as a competent web admin dashboard rendered in a window. Five changes convert it into Windows software.

## 7.2 The five highest-impact visual changes

1. **Build the custom 32px title bar.** `"decorations": false`, a `data-tauri-drag-region` bar carrying the app mark, the document context ("Job Search — 234 postings") and custom minimise/maximise/close. `--titlebar-height` already exists and is unused; `core:window:allow-start-dragging` is already granted. Nothing else converts "a web page in a frame" into "an application" as cheaply, and it is what `mock.png` actually shows.
2. **Ship Inter Variable and JetBrains Mono.** Self-hosted under `frontend/public/fonts/`, `@font-face` with `font-display: block` and `font-weight: 100 900` on the variable face. Until this happens every weight and tracking value in the spec is aspirational.
3. **Halve the job row and put "Apply" back in it.** `[logo 28] [title · company] [tech chips, truncated] [salary] [score] [age] [save] [Prepare]` on two lines instead of three: ~86px → ~52px, **10 postings per screen → 17**. In `mock.png` every match row ends with a solid violet Apply; in the implementation the primary action of the entire product is two clicks and a modal away.
4. **Break the flat card grid.** Six dashboard cards on identical `--surface-1` with identical radius and shadow, differentiated only by `span-N`, give the eye no entry point after the KPI row. One dominant panel on `--surface-1` + `--shadow-card`; supporting panels demoted to bordered `--bg-app` with no shadow.
5. **Replace the job-detail modal with a resizable right pane.** `JobDetailPanel` is named a panel and is a 1040px modal that blacks out the list you were scanning. `rail | list | detail` at min 380 / default 480, persisted. Scanning a list while reading one item is the core desktop interaction the product does not have, and it is the change the user will feel in every session.

## 7.3 Navigation

Ten flat rail items is two too many. Group with `.t-overline` section labels:

- **Find** — Dashboard, Job Search
- **Apply** — Applications, Documents, Email
- **Operate** — Automation, Analytics, Activity
- pinned to the foot beside the existing user block — Profile, Settings

Then build the command palette the design already implies (`--overlay` exists, `--shadow-modal`'s comment names it, the `Ctrl K` keycap is already on screen). `Ctrl+K` currently focuses a text input; it should open a palette over jobs, companies, applications, documents and every navigation target. Add `Ctrl+1..9` for views, `/` for filter, `j`/`k` for list traversal, `Ctrl+Enter` to prepare an application.

Fix the rail collapse: initialise from the viewport once, persist the user's toggle, and only auto-collapse when crossing 1100px **downward**.

## 7.4 Per-screen direction

| Screen | V1 essential | Can wait |
|---|---|---|
| **Dashboard** | KPI row; **Recent matches as the dominant panel** with the dense row and per-row Prepare; pipeline summary; automation state; the existing zero-data states (keep exactly as they are). **Cut Quick Actions entirely** — four cards duplicating the rail, one destination twice. | Insights card, range selector on the activity chart |
| **Job Search** | Three-pane with the detail in a resizable right pane; filters collapsed to an active-chip summary bar; density toggle (Comfortable 52 / Compact 40, persisted); per-row Prepare; partial-result strip naming failed sources | Saved searches, "Applied / Saved / New" segmented control |
| **Applications** | Kanban with **optimistic drag** and a stage `<select>` in the detail modal so it is keyboard-operable; legal-transition enforcement; the answer pack with copy-to-clipboard; follow-up and ghost badges | Column count tick animation, bulk actions |
| **Documents** | Master CV; tailored CV + cover letter per application; **PDF and DOCX download**; version history and restore (already excellent); the validation verdict panel with per-claim Keep/Remove | Multiple templates, an editor with a diff view |
| **Email** | **Remove from V1 entirely** and replace with the follow-up reminder surface inside Applications. Shipping a schema and a form that cannot send is worse than shipping nothing. | V1.5: Gmail OAuth read-only + reply classification with suggest-then-confirm |
| **Automation** | The pipeline strip **promoted to the page header** (it is the best component in the product); run control; **schedule** (the thing that does not exist); guard rails on save-on-blur with an explicit Save, never on keystroke; source toggles + slug management | Per-stage model overrides |
| **Analytics** | Real error states on all eight requests; the existing numerator/denominator honesty (keep); funnel definitions corrected | Cohort analysis, source ROI |
| **Profile** | As today (the `ListEditor` and sticky unsaved bar are good); **plus** the answer knowledge base as a seventh tab | Multiple profiles |
| **Settings** | Health panel with backend / Python / Ollama / model status, the data directory, **the log file**, and "Check again"; the source capability table; the boundary cards (keep) | Backup / restore / factory reset (V1.5) |
| **Activity** | As today | Filter by run |
| **NEW: Getting Started** | When the backend is unreachable, replace the identical `ErrorState` on ten screens with **one diagnostic view**. The `dialog` plugin is already loaded and permitted for exactly this and is idle. | — |

## 7.5 Colour fixes (three lines, closes the accessibility gap)

1. `--text-muted`: `#63718c` → **`#7D8AA4`** (≈4.6:1 on `--surface-1`). One line, fixes the most widespread failure in the product.
2. Add `--status-pipeline-text` and `--status-info-text` at ≥4.5:1 on their tints; keep the current values for fills and bars. This is the pattern `DESIGN.md` already invented for `--score-weak` — apply it consistently instead of once.
3. Add `--accent-text ≈ #9B86FF` for inline accent links and the focus ring.

Then update `DESIGN.md` §1 with these tokens so the spec and the code stay in agreement.

## 7.6 Enforce the design system

`DESIGN.md` is a good spec that the code drifts from by 49% on spacing alone. Make drift impossible rather than discouraged — this is exactly what `ai-job-hunter-app` does with a 26 KB `eslint.config.mjs`:

- An ESLint rule erroring on any raw `#RRGGBB` in TSX (currently 1 occurrence) and on any numeric `gap`/`padding`/`margin` literal not in `{4,8,12,16,20,24,32,40,48}`.
- A stylelint rule erroring on any colour literal in CSS outside `tokens.css`.
- A CI check erroring on any `fontSize` outside the nine `.t-*` classes.
- A contrast test asserting every token pair used for text clears 4.5:1.

---

# 8. Recommended automation workflow

## 8.1 Principles

1. **Deterministic work is cheap and runs on everything. Inference is expensive and runs on a shortlist.** ApplyPilot's regex pre-filter validated against 5,938 rows is the proof.
2. **A scheduled run never spends more than a bounded budget** — of wall-clock, of model calls, and of prepared packages.
3. **Nothing is irreversible.** The product never submits; the worst outcome of a bad run is a prepared package the user deletes.
4. **Every run explains itself.** Per-source counts, skip reasons, errors, what was filtered and why.
5. **The kill switch always wins**, including mid-stage. This already works; do not regress it.

## 8.2 The run

```
STAGE 1  DISCOVER            per source, concurrent, per-host rate-limited,
                             1 retry with jittered backoff, honest SourceResult
STAGE 2  NORMALISE           pure, deterministic
STAGE 3  DEDUPE              exact → content hash → fuzzy, duplicates retained
STAGE 4  PRE-FILTER          deterministic knockouts, NO model:
                             excluded company · excluded keyword · wrong country
                             with no relocation · seniority ≥2 ranks away ·
                             salary below floor when stated · older than 45 days
STAGE 5  SCORE (det.)        six dimensions, every surviving job, no network
STAGE 6  SCORE (model)       ONLY the top N by deterministic score
                             (N = min(40, jobs above min_score)), cached by
                             (job.content_hash, profile_version, prompt_version)
STAGE 7  SELECT              score ≥ min_score AND ≤ daily_application_limit,
                             highest first, at most 2 per company per run
STAGE 8  PREPARE             tailored CV + cover letter + screening answers,
                             validated, rendered to PDF + DOCX
STAGE 9  ROUTE               mailto → READY_TO_SEND
                             everything else → ACTION_REQUIRED with the package
STAGE 10 FOLLOW-UP           applications with no response after N days → due
STAGE 11 REPORT              per-source summary, counts, errors, what was skipped
```

The change that matters: **stage 6 runs on a shortlist, not on 400 jobs.** With a 30B local model at even 20s per call, 400 calls is 2¼ hours; 40 calls is 13 minutes. Combined with caching, a second run over an unchanged corpus costs nothing.

## 8.3 Scheduling

Steal `ai-job-hunter-app`'s design wholesale; it is the best scheduler in the reference set.

- Cadences: `manual | daily | twice_daily | weekly`, at a user-set local hour and minute (default 08:00).
- Due-ness computed against `last_occurrence_ms` — **the most recent occurrence at or before now**. This gives crash catch-up for free without double-firing, which a naive `next_run_at` does not.
- **Deterministic per-install jitter**: FNV-1a over the config id into a 10-minute window. We are one user, so the thundering-herd argument is weaker — but Adzuna and Jooble free tiers are per-key and a fixed 08:00 hit is a needless pattern. Cheap insurance.
- APScheduler in the backend process, started inside the FastAPI lifespan (mr-jobs' invariant #9 — configure outside the loop, start inside it).
- **The scheduler enqueues a `task`; it never runs the pipeline inline.**
- On startup, reconcile: any `automation_runs` row still `running` with a dead task id becomes `INTERRUPTED` with `finished_at` set.

## 8.4 Limits, retries, failure

| Control | Value | Enforced where |
|---|---|---|
| `daily_discovery_limit` | 400 | stage 1, **actually read this time** |
| `daily_application_limit` | 10 | stage 7, re-read at each checkpoint |
| Max per company per run | 2 | stage 7 |
| Model calls per run | 60 | stages 6 + 8, hard ceiling |
| Wall-clock budget per run | 45 min | checkpoint; exceeding it ends the run `COMPLETED_PARTIAL`, never `FAILED` |
| Per-host rate limit | 20 req / 60 s sliding | `sources/base.py` |
| Source retry | exactly 1, backoff 5s + jitter, **0 retries on a metered aggregator** | `sources/base.py` |
| LLM retry | 1 on a transport error, 0 on a parse error | `llm/ollama.py` |
| Stage failure | isolated — a failed stage marks itself and the run continues; only a failed *checkpoint* aborts | `automation.py` |
| Emergency stop | DB-backed, re-read at every checkpoint | keep as-is |

The `retries: 0` on metered providers deserves quoting to the Developer, because the reasoning is not obvious: *a 429 from a metered API **is** the over-quota signal, so retrying answers "you are out of quota" by spending more of it.*

## 8.5 Follow-up and ghost detection

mr-jobs' highest-value-per-line feature, and pure SQL:

- On entering `SUBMITTED`, set `follow_up_due = submitted_at + config.follow_up_after_days` (default 7).
- Nightly: applications past `follow_up_due` with no inbound email → surface in an **Action Required** card on the dashboard with a pre-filled follow-up draft.
- Applications `SUBMITTED` more than 21 days ago with zero inbound → `stage = GHOSTED` (add it as a 12th stage; it is a real outcome and the pipeline currently has nowhere to put it). `GHOSTED` ranks as **live and reopenable**, not terminal — an employer resurfacing after ghosting is exactly the case the stage exists for.

---

# 9. Recommended AI strategy

## 9.1 The split — what is deterministic and what is inference

| Always deterministic, never a model | Model, always bounded |
|---|---|
| Source fetching, pagination, rate limiting | Qualitative strengths / gaps per job |
| Normalisation, technology extraction, seniority, remote type, salary | Score adjustment, **clamped to ±8** |
| URL canonicalisation and ATS resolution | CV **section selection and ordering** |
| Dedup (exact, hash, fuzzy) | CV **bullet rephrasing**, bounded to source content |
| **All six scoring dimensions** | Cover-letter **prose**, from code-supplied facts |
| Pre-filter knockouts | Screening answers **for questions not in the knowledge base** |
| Every truthfulness Critical | CV import structure extraction (already) |
| Stage transitions, limits, dedup of applications | Email reply classification (V1.5) |
| Document assembly from profile fields | — |
| Answer lookup from the knowledge base | — |
| Every analytic | — |

**The invariant, to be written into `CLAUDE.md` as rule 7:**

> The model never originates a fact. It selects, orders, and rephrases content that already exists in the candidate profile. Every employer, title, date, institution, certification, technology, metric and contact detail in a generated document is written by Python from a profile field. A model that emits one is a defect, and the validator's job is to prove it did not.

This is the generalisation of ApplyPilot's *"header is always code-injected"* to the entire document, and it is what converts truthfulness from a prompt into a property.

## 9.2 Model and runtime strategy for local Ollama

**Change the default model.** `qwen3-coder:30b-32k` is wrong on three counts: it is a *coder* model being asked to do résumé prose and classification; it needs ~20 GB; and the tag is never created by anything in the repository. Recommend:

| Role | Model | Why |
|---|---|---|
| Default, shipped | **`qwen3:8b`** (or equivalent ~8B instruct) at `num_ctx 16384` | ~5 GB, runs on a normal laptop, good enough for selection/ordering/rephrasing when the facts are code-supplied |
| Optional, user-selectable | any Ollama tag the user has | list what `GET /api/tags` returns and let them pick per stage |
| Absent | no model | **everything still works** — deterministic scores, template documents, honest labels. This already works and is the product's best safety property. |

Ship an `ollama create` step in the first-run wizard that runs the `Modelfile` and **names the output tag**, or drop the `Modelfile` entirely and use a stock tag with `options: {num_ctx: 16384}` on each request — which is simpler and removes an undocumented manual step. **PO decision: drop the `Modelfile`, set `num_ctx` per request.**

**Runtime changes:**

- **Enable streaming.** `"stream": True` with token-by-token forwarding to the task's `progress` field. A three-minute generation with no output is indistinguishable from a hang.
- **Reduce the timeout to 90s** for scoring and 150s for documents, and make it configurable. 180s across the board hides real failures.
- **A semaphore of 1** on the Ollama client. Two concurrent requests to a local model on consumer hardware are slower than two sequential ones.
- **One retry** on a transport error, **zero** on a parse error (a model that returns malformed JSON twice will return it a third time).
- **Serialise the profile as JSON**, not Python `repr`.

## 9.3 Caching — the single biggest performance win available

There is currently none. Add a `llm_cache` table:

```
key         TEXT PRIMARY KEY   -- sha256(prompt_version | model | temperature | system | user)
kind        TEXT               -- 'score' | 'cv' | 'letter' | 'answer' | 'import'
response    TEXT
created_at  DATETIME
hit_count   INTEGER
```

Cache keys must include `prompt_version` and `model` so a prompt change or a model change is a structural miss, never a stale hit. Scoring is keyed additionally on `(job.content_hash, candidate.profile_version)`. Documents are keyed on `(job.content_hash, profile_version, template_version)`.

Effect: a second automation run over an unchanged corpus makes **zero** model calls. A rescore after a filter change is instant. This is what makes a local 8B model feel usable.

## 9.4 Prompt discipline

- **One module per prompt** under `llm/prompts/`, each exporting `VERSION`, `SYSTEM`, and a `build(...)` function. Versioned so the cache invalidates correctly and so a regression is attributable.
- **Everything the user did not type is untrusted and fenced.** The existing `wrap_untrusted` is good; extend it to prior-stage artifacts and any web-fetched content.
- **Every prompt asks for JSON**, uses Ollama's `format: "json"`, and has a Pydantic schema it is parsed into. A parse failure falls back to the deterministic path and **says so**.
- **Fix the greedy JSON fallback** in `extract_json` — `r"\{.*\}"` with `DOTALL` captures from the first `{` to the last `}`.
- **Per-stage model override** (ai-job-hunter-app's idea): let the user pin a bigger model to `cover_letter` and a small one to `score`. Absent means "the user asked for nothing", never a silent default.

## 9.5 Validation, and the refuse-to-export gate

Replace `truthfulness.py` with a real validator. Three tiers:

**Tier 0 — structural (prevention).** The document is assembled by Python from profile fields. Employers, titles, dates, institutions, certifications and contact details are never in the model's output at all. This eliminates most of the risk before validation runs.

**Tier 1 — Critical (blocks export).** Deterministic, computed in Python, never model opinion:

| Code | Check |
|---|---|
| `UNKNOWN_EMPLOYER` | a capitalised organisation-shaped run in the document that is not in the profile's employer/client set |
| `UNKNOWN_INSTITUTION` | likewise for education |
| `UNKNOWN_CERTIFICATION` | likewise for certifications |
| `UNKNOWN_TECHNOLOGY` | a technology token anywhere in the document (not only a Skills heading) that is not in the profile |
| `UNSOURCED_DATE` | a year or date range not present in the profile |
| `UNSOURCED_METRIC` | a numeric claim (`45%`, `40 microservices`, `2M requests`) not present verbatim in the profile |
| `DROPPED_ROLE` | a profile role silently absent (warning for a CV, since a one-page CV may legitimately omit early roles — but it must be reported) |
| `ALTERED_CONTACT` | any contact detail differing from the profile |
| `LENGTH_INFLATION` | generated CV > 160% of the master (the existing 40% floor has no ceiling) |

**Tier 2 — Warning (reported, does not block).** Keyword stuffing, structure, tone, banned phrases, em-dashes, LLM self-talk leakage (`"here is the revised"`, `"I apologize"` — ApplyPilot's `LLM_LEAK_PHRASES` is a good starting list).

**The gate.** A document with any unresolved Critical is stored with `validation_verdict = 'blocked'` and **cannot be exported to PDF or DOCX** until the user resolves each finding with an explicit **Remove** or **Keep (it's true, add it to my profile)**. "Keep" writes the fact into the profile, which is the correct resolution — if the claim is true it belongs in the source of truth.

**Cover letters go through the identical validator.** The current asymmetry — letters checked for nothing — is the single most likely source of a real-world fabrication.

**A CI eval harness**, copying `ai-job-hunter-app`'s approach: a fixtures directory of documents with planted defects (fabricated employer, fabricated metric, fabricated certification, altered date, dropped role, inflated length), and a test asserting each is caught. This is what stops the validator from silently rotting back into theatre.

---

# 10. Job sources

## 10.1 The four categories

| Category | Definition | Examples |
|---|---|---|
| **Discovery sources** | aggregate postings across many employers | RemoteOK, Remotive, Arbeitnow, HN Who-is-hiring, EURES |
| **ATS sources** | one employer's own board, via the ATS's public API | Greenhouse, Lever, Ashby, Workable, SmartRecruiters, Recruitee, Personio, Teamtailor |
| **Application providers** | anything that can *receive* an application | `mailto:` only. **Nothing else. Design for exactly one.** |
| **Email providers** | Gmail (OAuth), later generic IMAP/SMTP | V1.5 |

## 10.2 The recommended source set

**Tier 0 — keyless, works on a fresh install, no configuration:**

| Source | Endpoint | Note |
|---|---|---|
| RemoteOK | `remoteok.com/api` | already built; Cloudflare-fronted, will sometimes 403 — report honestly |
| Remotive | public JSON | broad remote coverage, EU-friendly |
| Arbeitnow | public JSON | **explicitly EU/DE-focused** — the closest thing to a European default |
| HN Who-is-hiring | Algolia, **`search_by_date`** | fix the ranking bug; mine ATS URLs out of comment bodies (mr-jobs' `hn_source` does this well) |
| EURES | official EU public job mobility API | the only genuinely pan-European public source; **highest priority new source for this user** |

**Tier 1 — company-scoped ATS, keyless, needs a slug:**

Greenhouse, Lever, Ashby, Workable, SmartRecruiters, Recruitee, **Personio** (very large in DE/AT, `{co}.jobs.personio.de/xml`), **Teamtailor** (very large in the Nordics and growing in PT/ES). All are public, documented, read-only, full-description, and legally unambiguous — this is where all three reference projects converged.

**Ship a seed table of ~120 European and Portuguese employers** with their ATS and slug, replacing the current 14 hardcoded US startups. Then **harvest passively**: every ingested URL that matches an ATS pattern teaches `companies` a new `(name, ats, slug)` row without a code change. ApplyPilot's runtime slug cache backfilled 405 URLs this way.

**Tier 2 — BYO-key aggregators, fail closed to empty:**

| Source | Why |
|---|---|
| **Adzuna** | official REST API, free tier, **a `pt` country endpoint**. This is the single highest-value integration for a Portuguese user and should be in the first-run wizard as an optional step. |
| **Jooble** | official API, free tier, strong PT/ES coverage |

No key → return `SourceResult(ok=True, jobs=[], skipped="needs-keys")`. **Never an error.** A missing key is a configuration state, not a failure.

**Tier 3 — Portuguese national boards.** ITJobs.pt, Landing.jobs, Net-Empregos. **Do not build these until their Terms of Service have been read.** If a public API or RSS feed exists and permits it, they are the highest-relevance sources available for this user. If the only route is HTML scraping against a ToS that prohibits it, they are **out** — the same rule that excludes LinkedIn and Indeed excludes them. The Developer must not implement any of these without an explicit Sponsor decision recorded in `docs/SOURCES.md`.

**Permanently rejected:** LinkedIn, Indeed, Glassdoor, StepStone, Xing, Workday scraping. `ai-job-hunter-app` retired all of them for anti-bot; ApplyPilot and mr-jobs reach them only through ToS-violating scraping. They stay out. Adzuna and Jooble already aggregate much of that inventory legitimately.

## 10.3 Source architecture

Formalise what `base.py` already gestures at:

```python
class Source(Protocol):
    id: str
    display_name: str
    kind: Literal["board", "ats", "aggregator"]

    # capability flags — the engine compensates and explains from these
    requires_company: bool      # needs a slug
    needs_key: bool
    supports_location: bool     # server-side geo filter?
    supports_keyword: bool
    is_all_remote: bool
    can_submit: bool            # False everywhere, and honestly so

    async def discover(self, query: SourceQuery, ctx: SourceContext) -> SourceResult
    async def from_url(self, url: str, ctx: SourceContext) -> Job | None
```

```python
@dataclass
class SourceResult:
    source: str
    board: str | None
    jobs: list[RawJob]
    ok: bool
    error: str | None = None
    skipped: str | None = None     # "needs-company" | "needs-key" | "rate-limited"
    truncated: bool = False
    notes: list[str] = field(default_factory=list)   # "location-filtered:7"
    health: SourceHealth | None = None
```

Three rules that follow:

1. **A per-board failure inside a multi-board source is never silently dropped.** It becomes an entry in `SourceResult.error` or a `note`. This closes P1-11 and honours `CLAUDE.md` rule 4.
2. **`supports_location=False` triggers a conservative central post-filter** that drops only rows whose *own* location clearly mismatches — never remote, never unknown-location. (ai-job-hunter-app's exact rule, and it is the right one.)
3. **The UI renders every `skipped` and `error`** as a per-source chip, and `source_health` distinguishes "found nothing today" from "broken since Tuesday".

## 10.4 The URL resolver

Steal mr-jobs' `url_resolver.py` design — an ordered chain, each strategy labelled in the result:

```
1. already an ATS application URL?           → done, resolution="direct"
2. companies table lookup (name → ats+slug)  → resolution="seed"
3. embedded ATS parameter (?gh_jid=, ?lever-) → canonicalise, resolution="embedded"
4. follow HTTP redirects                      → resolution="redirect"
5. extract the apply link from the landing page → resolution="extracted"
6. company careers page                       → resolution="fallback"
7. nothing                                    → resolution="unresolved" → ACTION_REQUIRED
```

The `resolution` field is not decoration: when the user says "this opened the wrong page", it is the only thing that makes the failure debuggable. Apply the same provenance principle to scores (`method`), answers (`source`) and status changes (`actor`) — the product already does this in three of four places.

---

# 11. Email

## 11.1 The decision: remove it from V1

Shipping a schema, nine routes, a form, and a `send_draft` that marks a message sent while transmitting nothing is worse than shipping nothing at all. It is exactly the class of defect this document criticises in the reference projects. **Delete the Email nav item and the routes for V1**, keep the models (the schema is fine), and surface follow-ups inside Applications where they belong.

## 11.2 V1.5 — Gmail, OAuth only, read-only

**Auth.** Google OAuth 2.0 **desktop/installed-app flow with a loopback redirect** (`http://127.0.0.1:<random>/`) and PKCE. The refresh token goes into the **Windows Credential Manager** via DPAPI; the database stores only the credential *name*, which is exactly what `email_accounts.credential_ref` already models and what `CLAUDE.md` rule 5 already mandates. **No app passwords.** `ai-job-hunter-app` uses IMAP app passwords and it is the weakest part of an otherwise strong codebase; Google is progressively restricting them.

Scope: `https://www.googleapis.com/auth/gmail.readonly` and nothing more. Read-only cannot send, cannot delete, cannot modify — the smallest scope that delivers the value.

**Onboarding honesty.** This requires the user to create a Google Cloud project and an OAuth client. That is a genuinely heavy step and the wizard must say so, offer to skip, and make clear that everything else in the product works without it.

**Sync.** Poll every 30 minutes: `q=newer_than:30d` + a `historyId` watermark, headers first, bodies only for fingerprint matches. Store `message_id` with a **unique** constraint (the current schema has an index but no uniqueness, so a re-sync would duplicate).

**Matching.** Deterministic and conservative, adapting mr-jobs' scoring but fixing its fatal flaw:

| Signal | Points |
|---|---|
| sender domain == company domain | 40 |
| known ATS sender pattern (`no-reply@greenhouse.io`, `@hire.lever.co`, …) | 25 |
| company name in subject | 25 |
| job title token overlap | 20 |
| within 60 days of `submitted_at` | 10 |

Threshold 50. **Below the threshold, the email is unmatched and stays unmatched.** mr-jobs matches on a bare substring and auto-mutates status with no confirmation — "my Block application got marked rejected because a recruiter from Blockchain Inc emailed me". We do not do that.

**Classification.** LLM, fenced as untrusted, into `confirmation | rejection | interview | offer | other`, with the prompt explicitly instructing that the email body is data and any instruction inside it must be ignored.

**Status advancement: suggest, never apply.** A classified email produces a **suggestion** — a dashboard card reading "Gmail thinks Acme rejected your application on 3 Sep. Move to Rejected?" with Confirm / Dismiss. One click, full provenance, reversible. `ai-job-hunter-app` gets this right (`auto_write` defaults off and **always writes `confirmed = false` — the unconfirmed row IS the whole safety model**); mr-jobs gets it dangerously wrong.

## 11.3 V2 — sending

Gmail send scope, follow-up emails only, always with a preview-and-confirm step, never unattended, never in an automation run. A daily cap. And a hard rule: **the product never sends an application** — only a follow-up to a conversation the user already started.

---

# 12. Candidate profile — the canonical model

The existing `candidates` table is close. It is the source of truth for job matching, CV generation, cover letters, screening answers, recruiter messages and (later) the landing page, so it must be complete enough that **nothing downstream ever needs a fact it does not hold**.

```
identity        full_name, preferred_name, headline, summary, photo_path
contact         email, phone, location{city, region, country}, timezone,
                links{linkedin, github, portfolio, other[]}
authorisation   work_authorisation[] (country → status), needs_sponsorship,
                notice_period_days, earliest_start
experience[]    company, company_url, title, employment_type, location,
                remote_type, start, end, is_current, summary,
                bullets[]{text, technologies[], metric?},        ← the atom of a CV
                technologies[], clients[]
education[]     institution, degree, field, start, end, grade
certifications[] name, issuer, issued, expires, credential_id, url
projects[]      name, url, role, summary, bullets[], technologies[]
languages[]     language, level (CEFR)
skills          primary[], secondary[], tools[], methodologies[]
targets         roles[], seniority[], locations[], countries[], remote_only,
                accepts_hybrid, accepts_onsite, willing_to_relocate,
                min_salary, salary_currency, salary_period
exclusions      companies[], keywords[], industries[]     ← currently dead, must be enforced
answers         → the `answers` table (work auth, sponsorship, notice, salary
                  expectation, relocation, referral source, EEO defaults)
meta            profile_version, is_active, created_at, updated_at
```

**Three changes that matter most:**

1. **`experience[].bullets[]` becomes a first-class structured list, not prose.** This is what makes tailoring structural: the model returns *which bullets, in which order, rephrased how* — and Python assembles. A CV cannot contain an achievement the profile does not list. Without this, every other truthfulness control is downstream of a free-text blob.
2. **`bullets[].metric`** captures the numbers explicitly (`45`, `%`, `AWS spend reduction`), so `UNSOURCED_METRIC` becomes a set membership test rather than a regex guess.
3. **The `answers` table is part of the profile**, surfaced as a Profile tab. Every screening question answered once is answered forever, ranked `human > profile > model`, exportable as YAML so the user can review the whole set at a glance.

**Import.** The existing `cv_import.py` (PDF/DOCX → LLM → structured preview → user reviews before applying) is the right shape and the review-before-apply step is exactly correct. It is also the **highest-risk code in the repository and has zero tests** — the binary parsers must be covered before V1.

**Versioning.** `profile_version` already increments. Make it *mean* something: every `job_score` and `document` records the version it was built from, and anything stale renders as "needs regenerating" rather than as current.

---

# 13. Document system

## 13.1 The document set

| Document | Source | Validated | Formats |
|---|---|---|---|
| **Master CV** | pure template over the profile | n/a — cannot fabricate by construction | MD, PDF, DOCX |
| **Tailored CV** | Python assembly from model-selected bullets | full validator, blocks export on a Critical | MD, PDF, DOCX |
| **Cover letter** | model prose from code-supplied facts | **full validator — same rules as the CV** | MD, PDF, DOCX |
| **Answer pack** | knowledge base first, model for the rest | per-answer fabrication check | MD, clipboard |
| **Recruiter message** | template + model rephrase | validator | text, clipboard |

## 13.2 Rendering

- **PDF:** one HTML/CSS template → **WeasyPrint**. Pure Python, PyInstaller-friendly, no browser dependency, `@page` rules, embedded fonts, and the same template feeds the HTML export the product already has. (Typst produces better typography and is what `ai-job-hunter-app` uses, but it is a binary dependency to bundle and sign; that is a V2 upgrade, not a V1 requirement.)
- **DOCX:** **python-docx**, from the same structured document model, not by re-parsing the Markdown. One `DocumentModel` (header + titled sections of paragraphs/bullets/entries), two backends that *translate* it. This is `ai-job-hunter-app`'s architecture and it is correct.
- **Two templates for V1**, both ATS-safe single-column: "Classic" and "Compact". Sixteen templates is the maintenance trap `ai-job-hunter-app` walked into.
- **Filenames:** `Nuno_Marques_Senior_Full_Stack_Developer_Acme.pdf`. Recruiters see it; it should read like a person made it.

## 13.3 Version history

Already correct. `lineage_key`, `is_current` flipping, monotonic version, `/versions`, `/restore`, user edits as new versions, `DELETE` refusing the current one. Two additions: a **unique constraint** on `(lineage_key, version)` closing the read-then-write race, and the **rendered PDF/DOCX paths stored per version** so a restore restores the artefacts too.

## 13.4 Export

Route every export through `@tauri-apps/plugin-opener` (or a Tauri save dialog — the `dialog` plugin is already permitted and idle). The current `window.open` path is dead in a packaged build, and it is the only route out of the app for a generated CV.

---

# 14. Windows distribution

## 14.1 What ships

```
Job Hunter_1.0.0_x64-setup.exe        NSIS, per-user, no admin prompt
  ├─ Job Hunter.exe                   Tauri shell
  ├─ job-hunter-backend.exe           PyInstaller one-folder bundle
  ├─ resources/templates/             CV templates, fonts
  └─ WebView2 bootstrapper            (downloadBootstrapper, as today)
```

Not bundled, by design: **Ollama** and the model. They are optional, the product degrades honestly without them, and an 18 GB installer is not a product.

## 14.2 Build pipeline

```
1. npm --prefix frontend run build            → frontend/dist
2. pyinstaller backend/job-hunter-backend.spec → dist/job-hunter-backend/
3. copy that into src-tauri/binaries/ as an externalBin sidecar
4. npx tauri build                            → NSIS + MSI
5. signtool sign /fd sha256 /tr <timestamp>   → signed installer
```

Steps 2 and 3 do not exist yet and are the whole of P0-1.

## 14.3 First launch, corrected

| Now | Target |
|---|---|
| Window hidden, `start()` blocks up to 90s | **Window shows immediately** with a startup state: "Starting the local service…" and a live log tail |
| Bare TCP probe on 8756, adopts any listener | `GET /api/health` probe, and a mismatched response is an error the user sees |
| `python` from PATH → Store alias stub | sidecar `job-hunter-backend.exe`, no PATH involvement |
| stdout/stderr to `/dev/null` | piped to `%LOCALAPPDATA%\JobHunter\logs\backend-YYYY-MM-DD.log`, rotated, **surfaced in Settings with "Open log folder"** |
| No supervision | health poll every 10s; one automatic restart on crash; a second failure surfaces the log with a Report button |
| `window.eval` race | `initialization_script()`, which also lets us drop `'unsafe-inline'` from `script-src` |
| No updater | `tauri-plugin-updater`, minisign pubkey pinned, GitHub Releases `latest.json`, check 10s after launch then every 4h |
| Unsigned | code-signed; SmartScreen reputation accrues from the first signed release, so sign early even if the certificate is cheap |

## 14.4 Managing the Ollama dependency

Three states, all handled honestly — and the existing degradation path already does most of this well:

| State | Behaviour |
|---|---|
| Ollama absent | Health chip: "Model offline". Scores are deterministic and **labelled** "Scored without the model". Documents come from templates and say so. Settings offers a **"Set up local AI"** panel: what Ollama is, a link to the download, the exact `ollama pull` command with a copy button, and a "Check again" button. |
| Ollama present, model not pulled | The same panel, pre-filled with the recommended model, listing what *is* available so the user can pick one they already have. |
| Ollama present, model ready | Full path. Show the model name and context size in Settings. |

Never block the product on it. The user must be able to discover, score, track and export a template CV on the first run with nothing installed. **This is already true and is one of the product's best properties — protect it.**

---

# 15. First-run experience

## 15.1 What happens, step by step

**Install.** Double-click, no admin prompt, per-user into `%LOCALAPPDATA%`. Signed, so no SmartScreen wall.

**Launch.** The window appears in **under one second**, showing the shell with a startup banner. The backend starts behind it. If it fails, the user sees a diagnostic panel — not ten identical "the backend is not responding" error states.

**Wizard — six steps, everything skippable, nothing required.**

| # | Step | Content | Skippable |
|---|---|---|---|
| 1 | **Welcome** | What the product does, in three sentences, including the sentence that matters: *"Job Hunter prepares your applications. It never submits one on your behalf and never invents anything about you."* | — |
| 2 | **Your CV** | Drag a PDF/DOCX, or paste text, or fill the form. Import runs as a background task with real progress, then a **review-before-apply preview** (this already exists and is well built). | yes → empty profile |
| 3 | **What you're looking for** | Target roles, seniority, locations/countries, remote preference, minimum salary, exclusions. Pre-filled from the imported CV. **This is what makes discovery work**, so it gets the most careful copy. | yes → broad defaults |
| 4 | **Local AI** | Ollama status. If absent: what it is, the download link, the `ollama pull` command with a copy button, "Check again", and a prominent **"Skip — I'll use the deterministic mode"**, with an honest explanation of what changes. | yes |
| 5 | **Job sources** | Pre-selected: the five keyless sources + the European ATS seed set. Optional: an Adzuna key (free tier, PT coverage, 60-second signup, with the link). **No key is a configuration state, never an error.** | yes |
| 6 | **Ready** | "Run your first search" as the single primary action. | — |

**Explicitly not in the wizard:** email setup (V1.5, and it needs a Google Cloud project — it belongs in Settings, opt-in, never on the critical path) and automation configuration (the user should see one manual run before choosing a cadence).

**First search.** Runs as a background task with a per-source progress strip. Results arrive with per-source counts and honest skip reasons. Deterministic scores are immediate. If the model is available, the top 40 get model refinement and the scores update in place.

**Demo mode.** The `sample` source is **disabled by default** and becomes an explicit Settings toggle: *"Load 5 example jobs so you can see how the product works. These are not real postings."* Example jobs are **flagged in the schema** (`is_demo`) and **excluded from every analytic**, which is not true today.

## 15.2 Daily workflow, once set up

```
Open the app
   ↓  the last automation run finished at 08:14 while it was closed
Dashboard      "12 new matches · 3 above 80 · 2 follow-ups due · 1 ghosted"
   ↓
Job Search     dense list, 17 per screen, sorted by score
               → arrow down the list, detail renders in the right pane
               → "Prepare" on the two strong ones
   ↓
Applications   two new cards in PREPARED, each with CV + letter + answer pack
               → open the employer's form (one click, the resolved ATS URL)
               → paste the answers from the pack, attach the PDF, submit
               → drag the card to SUBMITTED (or press a key, because it is
                 keyboard-operable now)
   ↓
Action required  two follow-ups due → review the pre-filled draft → send
                 one ghosted at 21 days → archive or chase
   ↓
Close.         Total elapsed: under fifteen minutes.
```

That is the product. Not a thousand applications in two days — **two good applications in fifteen minutes, every day, with nothing invented and nothing forgotten.**

---

# 16. Roadmap

## MVP — "it installs, it finds real jobs, it produces a real document, and it does not lie"

Everything here is P0. Nothing below this line matters until all of it is done.

| Feature | Priority | Why | Depends on | User value |
|---|---|---|---|---|
| PyInstaller sidecar + Tauri `externalBin` | P0 | the `.exe` is currently a dev artefact | — | the product can be installed |
| Show the window immediately + startup/diagnostic state | P0 | 90s of nothing is where users quit | sidecar | the product looks alive |
| Backend logs to disk, surfaced in Settings | P0 | zero diagnostics today | sidecar | failures are debuggable |
| Health-probe port adoption + `initialization_script` | P0 | silent wrong-port failures | — | reliability |
| Alembic migrations | P0 | cannot be retrofitted after users exist | — | upgrades do not brick data |
| PDF + DOCX rendering | P0 | output is currently unusable | doc model | the user can actually apply |
| Structural truthfulness (Tier 0 + Tier 1 + gate) | P0 | rule 1 is unenforced | profile bullets | the core promise becomes true |
| Cover letters through the same validator | P0 | currently checked for nothing | validator | the riskiest document is covered |
| European + Portuguese sources (EURES, Arbeitnow, Remotive, Adzuna, EU ATS seeds) | P0 | discovery is non-functional for this user | source protocol | there are jobs to apply to |
| Token-based keyword matching replacing the phrase substring | P0 | `"Fullstack"` currently misses | — | matches are found |
| `.NET` technology vocabulary expansion | P0 | the user's entire stack is invisible | — | scores mean something |
| `sample` disabled by default + `is_demo` excluded from analytics | P0 | fake data in real analytics | — | honesty |
| Fix the dashboard `TypeError` | P0 | the home screen 500s | — | the app opens |
| Ship Inter + JetBrains Mono | P0 | the whole type spec is unrealised | — | it looks designed |

## V1 — "it runs itself, it tracks everything, and it is pleasant to use"

| Feature | Priority | Why | Depends on | User value |
|---|---|---|---|---|
| Background task queue + progress | P1 | 6-minute requests, no progress | — | the UI never blocks |
| APScheduler, clock-anchored + jitter + catch-up | P1 | there is no scheduler at all | task queue | it works while the app is closed |
| Startup reconciliation of interrupted runs | P1 | "running" forever after a crash | task queue | state is trustworthy |
| LLM response cache | P1 | every rescore pays full price | — | a local model becomes usable |
| Shortlist-only model scoring (top 40) | P1 | 400 sequential calls | cache | a run finishes in minutes |
| Enforce the six dead guard rails | P1 | settings that silently do nothing | — | the user is actually in control |
| Score invalidation on profile/formula version | P1 | stale scores drive automation | — | decisions use current data |
| Stage state machine + `application_events` table | P1 | `rejected → discovered` accepted | migrations | the pipeline is coherent |
| Remove the submission counter and the Email nav item | P1 | reporting on capabilities that do not exist | — | the product stops lying |
| Answer knowledge base + answer pack + clipboard | P1 | the compounding asset | profile | each application gets faster |
| URL resolver with provenance | P1 | "open posting" must open the form | companies table | one click to the right page |
| Follow-up + ghost detection | P1 | cheapest high-value feature there is | events table | nothing is forgotten |
| Per-source health + skip reasons in the UI | P1 | "0 results" is not a diagnosis | source protocol | discovery is trustworthy |
| Source rate limiting + one retry | P1 | none today | source protocol | fewer spurious failures |
| Custom title bar + window state persistence | P1 | it reads as a web page in a frame | — | it feels like an application |
| Three-pane Job Search with a resizable detail pane | P1 | a modal blacks out the list | — | the core desktop interaction |
| Dense rows + per-row Prepare + density toggle | P1 | 10 postings per screen | — | the promised density |
| Contrast token fixes | P1 | measured AA failures throughout | — | it is readable |
| Keyboard-operable Kanban + optimistic drag | P1 | the central workflow is mouse-only | — | it is usable and fast |
| ErrorBoundary + real error states in Analytics | P1 | white screens, errors shown as "no data" | — | failures are visible |
| Command palette (`Ctrl+K`) | P1 | the design already promises it | — | speed |
| `@tauri-apps/plugin-opener` for every external open | P1 | export is dead in the package | — | files leave the app |
| Auto-updater | P1 | users are frozen forever | signing | fixes reach people |
| pytest migration + API/source/LLM test coverage | P1 | nothing networked is tested | — | changes stop breaking things |

## V1.5 — "it reads the replies and it is safe to depend on"

| Feature | Priority | Why | Depends on | User value |
|---|---|---|---|---|
| Gmail OAuth read-only + credential store | P2 | replies are the missing signal | — | the pipeline updates itself |
| Reply classification + conservative matching | P2 | — | OAuth | rejections and interviews detected |
| Suggest-then-confirm status advancement | P2 | never auto-mutate on a guess | classification | one-click truth, reversible |
| Backup / restore / factory reset | P2 | a desktop app owns the user's data | migrations | data is portable |
| Code signing + SmartScreen reputation | P2 | "Unknown publisher" on every install | — | trust at install |
| Company→ATS seed table + passive harvesting | P2 | the slug cold-start problem | companies table | discovery grows itself |
| Ghost-job / trust signal | P2 | dead postings waste real effort | — | fewer wasted applications |
| Design-system lint enforcement | P2 | 49% spacing drift | — | the spec stops rotting |
| Per-stage model override | P3 | big model for prose, small for scoring | cache | quality per second |

## V2 — "it is a category-leading product"

| Feature | Priority | Why | User value |
|---|---|---|---|
| Semantic search (FTS5 + embeddings + RRF) | P3 | keyword matching has a ceiling | finds jobs keywords miss |
| Gmail send (follow-ups only, preview-and-confirm) | P3 | closes the loop | one less context switch |
| Interview preparation pack per application | P3 | the natural next stage | value after the application |
| Multiple CV templates + a diff view | P3 | different roles want different shapes | polish |
| Salary intelligence from the user's own corpus | P3 | the data is already there | negotiation leverage |
| The public CV landing page (currently on hold) | P3 | one profile, two outputs | a link to put in an application |
| macOS build | P3 | the stack already supports it | reach |

---

# 17. Engineering task list

Ordered. Each task is independently implementable, independently testable, and sized for one focused session. `[P0]`/`[P1]`… is the priority; `→` lists dependencies by task number.

> **Standing rules for every task.** (a) Run `npm run test:backend`, `npm run typecheck` and `npm run test:smoke` before declaring done. (b) UI work follows `DESIGN.md` and the `ui-kickoff` skill — **no screen changes without visual verification in a running window**, per the Sponsor's standing rule. (c) Any feature removed or renamed must also be removed from `README.md` and `CLAUDE.md` in the same commit. (d) Never document a capability that is not implemented.

---

### Phase A — make it installable and diagnosable

**TASK 001 [P0] — Freeze the backend with PyInstaller**
*Objective:* produce `job-hunter-backend.exe` that starts uvicorn with no system Python.
*Files:* new `backend/job-hunter-backend.spec`, `backend/entry.py`, `package.json` scripts.
*Depends on:* —
*Acceptance:* on a Windows VM with **no Python installed**, `job-hunter-backend.exe --port 8756` serves `GET /api/health` with 200. The bundle includes every `requirements.txt` dependency. Cold start is under 5 seconds.
*Tests:* a CI step building the exe and curling `/api/health`.

**TASK 002 [P0] — Register the backend as a Tauri sidecar** → 001
*Objective:* remove the `python` dependency from the shell entirely.
*Files:* `src-tauri/tauri.conf.json` (`bundle.externalBin`), `src-tauri/src/backend.rs`, `capabilities/default.json`.
*Acceptance:* `python_command()` and its four PATH probes are deleted. `npx tauri build` produces an installer that runs on a clean VM. `bundle.resources` no longer ships `backend/app` or `requirements.txt`.
*Tests:* a manual clean-VM install checklist recorded in `docs/RELEASE.md`.

**TASK 003 [P0] — Show the window immediately, with a startup state** → 002
*Objective:* the window appears in under one second regardless of backend state.
*Files:* `src-tauri/src/main.rs`, `frontend/src/app/Shell.tsx`, new `frontend/src/views/StartupView.tsx`.
*Acceptance:* `window.show()` happens before `backend::start()`. The renderer shows "Starting the local service…" with a live log tail and switches to the app when `/api/health` answers. After 20 seconds without a backend it shows the diagnostic panel from TASK 005.
*Tests:* Playwright against `tauri dev` with the backend deliberately blocked.

**TASK 004 [P0] — Backend logging to disk** → 002
*Objective:* no failure is ever silent.
*Files:* `src-tauri/src/backend.rs`, `backend/app/core/logging.py`, `backend/app/main.py`.
*Acceptance:* child stdout/stderr are piped to `%LOCALAPPDATA%\JobHunter\logs\backend-YYYY-MM-DD.log`, rotated at 5 MB, 7 files retained. The backend logs startup, every request over 1s, every LLM call with its duration, and every unhandled exception. **No credential, no password and no full document body is ever logged.**
*Tests:* a unit test asserting the redaction filter; a manual check that a forced crash leaves a readable traceback on disk.

**TASK 005 [P0] — The diagnostic panel** → 003, 004
*Objective:* one honest failure screen replaces ten identical error states.
*Files:* new `frontend/src/views/DiagnosticsView.tsx`, `SettingsView.tsx`, `api/system.py`.
*Acceptance:* shows backend status, sidecar path, port, Ollama status, model status, data directory, log path, "Open log folder", "Copy diagnostics", "Check again". Reachable from Settings at all times and shown automatically when the backend is unreachable.
*Tests:* a route test for the extended `/api/info`; visual verification.

**TASK 006 [P0] — Health-probe port adoption and `initialization_script`** → 002
*Objective:* never adopt a foreign listener; never race the API address injection.
*Files:* `src-tauri/src/backend.rs`, `src-tauri/src/main.rs`, `frontend/src/lib/api.ts`, `tauri.conf.json` (drop `'unsafe-inline'` from `script-src`).
*Acceptance:* `port_in_use` probes `GET /api/health` and requires a Job Hunter response shape. The API address is injected via `WebviewWindowBuilder::initialization_script()`. Starting a foreign server on 8756 makes Job Hunter pick another port and log why.
*Tests:* a Rust unit test for the probe; a manual test with a decoy server on 8756.

**TASK 007 [P0] — Backend supervision** → 004
*Objective:* a crashed backend recovers or explains itself.
*Files:* `src-tauri/src/backend.rs`, `src-tauri/src/main.rs`.
*Acceptance:* health poll every 10s; one automatic restart on a failed poll; a second failure shows the diagnostic panel with the log tail. Shutdown still kills the child (this already works — do not regress it).
*Tests:* kill the child process manually and observe exactly one restart.

---

### Phase B — make the data durable and the work asynchronous

**TASK 008 [P0] — Introduce Alembic**
*Objective:* the schema can evolve without destroying installed databases.
*Files:* new `backend/alembic.ini`, `backend/app/db/migrations/`, `backend/app/db/session.py`, `requirements.txt`.
*Acceptance:* `init_db` runs `alembic upgrade head` instead of `create_all`. An existing database is stamped at the baseline revision on first run without data loss. A second revision adding a nullable column applies cleanly to both a fresh and an existing database.
*Tests:* a test that creates a v0.2-shaped database, upgrades it, and asserts the data survived.

**TASK 009 [P1] — The task queue** → 008
*Objective:* no HTTP request ever does minutes of work.
*Files:* new `backend/app/models/task.py`, `services/tasks.py`, `api/tasks.py`; `main.py`.
*Acceptance:* a `tasks` table; a `ThreadPoolExecutor(2)` worker; `POST /api/tasks` and `GET /api/tasks/{id}` with `status`, `progress`, `stage`, `result`, `error`; tasks survive a restart as `INTERRUPTED`, never as `running`.
*Tests:* unit tests for enqueue / progress / cancel / restart-reconciliation.

**TASK 010 [P1] — Move discovery, scoring, preparation and CV import onto the queue** → 009
*Objective:* four endpoints stop blocking.
*Files:* `api/jobs.py`, `api/applications.py`, `api/candidate.py`, `api/documents.py`.
*Acceptance:* each returns `202 {task_id}`. **Every route handler becomes `def`, not `async def`**, so FastAPI offloads blocking SQLAlchemy to its threadpool. No handler holds a request for more than 2 seconds.
*Tests:* route tests asserting 202 and a resolvable task id.

**TASK 011 [P1] — Task progress in the renderer** → 010
*Objective:* every long operation shows real progress.
*Files:* `frontend/src/lib/api.ts`, `hooks.ts` (new `useTask`), `JobsView.tsx`, `JobDetailPanel.tsx`, `ProfileView.tsx`.
*Acceptance:* a task-aware progress component with stage, percentage, elapsed time and **Cancel**. `fetch` gains an `AbortController` and a 30s default timeout. The 14px-spinner-for-six-minutes pattern is gone everywhere.
*Tests:* visual verification with a deliberately slowed backend.

**TASK 012 [P1] — Schema improvements** → 008
*Objective:* close the indexing, uniqueness and JSON-as-relation gaps.
*Files:* a migration, `models/job.py`, `models/document.py`, `models/email.py`, new `models/application_event.py`.
*Acceptance:* `job_technologies` relation replaces the `LIKE` substring search (both call sites); `created_at` indexed on four tables; unique constraints added on `email_accounts.address`, `email_templates.name`, `documents(lineage_key, version)`, `email_messages.message_id`; `application_events` created and dual-written alongside `stage_history`.
*Tests:* a test asserting the facet query issues no full-table scan; a concurrency test on document versioning.

---

### Phase C — make the product truthful

**TASK 013 [P0] — Structured bullets in the candidate profile** → 008
*Objective:* the atom of a CV becomes a structured record, not prose.
*Files:* `models/candidate.py`, `schemas/candidate.py`, `services/cv_import.py`, `ProfileView.tsx`, a migration.
*Acceptance:* `experience[].bullets[]` is `{text, technologies[], metric?}`. CV import populates it. The Profile editor edits it. Existing prose summaries are migrated into single bullets.
*Tests:* a migration test; import tests over three real CV fixtures.

**TASK 014 [P0] — Rewrite the validator** → 013
*Objective:* replace prompt-level theatre with a real, tested guarantee.
*Files:* `services/truthfulness.py` → `services/validation/{__init__,critical,warning,extract}.py`; new `tests/fixtures/validation/`.
*Acceptance:* all nine Critical codes from §9.5 implemented and **applied to the whole document**, not to one optional Markdown section. The dead `known` set and `_CAPITALISED_RUN` are either used or deleted. The fixture in §2.8 (`Lead Architect at Google` / `AWS Solutions Architect` / `BSc from MIT` / `Kubernetes` in a bullet) **fails with four Criticals**.
*Tests:* one fixture per Critical code plus five clean documents that must pass. This suite is the product's regression net — treat it as such.

**TASK 015 [P0] — Cover letters through the same validator** → 014
*Objective:* close the largest fabrication hole in the product.
*Files:* `services/documents.py`, `services/validation/`.
*Acceptance:* letters run the identical Critical set. The §2.8 letter fixture (`"I led the Kubernetes migration at Google… certification from MIT"`) fails. The 40% floor gains a **160% ceiling**.
*Tests:* letter fixtures mirroring the CV fixtures.

**TASK 016 [P0] — Structural document assembly** → 013, 014
*Objective:* the model stops originating facts.
*Files:* `services/documents.py`, new `llm/prompts/tailor_cv.py`, `llm/prompts/cover_letter.py`.
*Acceptance:* the tailoring prompt returns **JSON only** — `{sections: [{key, bullet_ids[], rephrased: {bullet_id: text}}], summary}`. Python assembles from profile fields. **Header, employers, titles, dates, institutions and certifications are never in the model's output.** A rephrased bullet that introduces a technology or a number not in its source bullet is rejected and the original is used.
*Tests:* a test asserting a model response containing `"Google"` cannot produce a document containing `"Google"` when the profile has no such employer.

**TASK 017 [P0] — The refuse-to-export gate** → 014, 015
*Objective:* a blocked document cannot become a PDF.
*Files:* `models/document.py`, `api/documents.py`, `DocumentsView.tsx`, a migration.
*Acceptance:* `validation_verdict` ∈ `clean|warnings|blocked`. Export returns **409** for `blocked`. The UI lists each Critical with **Remove** and **Keep (add to my profile)**; "Keep" writes the fact into the profile and re-validates.
*Tests:* route tests for 409 and for both resolution paths.

---

### Phase D — make the output usable

**TASK 018 [P0] — A single document model with two render backends** → 016
*Objective:* one structure, three outputs, no re-parsing.
*Files:* new `services/render/{model,html,pdf,docx}.py`; `requirements.txt` (+ `weasyprint`, `python-docx`).
*Acceptance:* `DocumentModel` (header + titled sections of paragraphs/bullets/entries). Markdown, PDF (WeasyPrint) and DOCX (python-docx) all render from it. Two ATS-safe templates. Fonts embedded. **The PyInstaller bundle includes WeasyPrint's native dependencies** — verify this on the clean VM, it is the likeliest packaging surprise.
*Tests:* golden-file tests on the HTML; a PDF test asserting page count and extractable text; a DOCX test asserting paragraph structure.

**TASK 019 [P0] — Wire PDF/DOCX into the API and the UI** → 018, 017
*Files:* `api/documents.py`, `models/document.py`, `DocumentsView.tsx`, `ApplicationsView.tsx`.
*Acceptance:* `GET /documents/{id}/export?fmt=pdf|docx|md|html`. Rendered paths stored per version; a restore restores the artefacts. Filenames follow `First_Last_Role_Company.pdf`.
*Tests:* route tests per format; a visual check of a real PDF.

**TASK 020 [P1] — Route every external open through the opener plugin** → 002
*Files:* all seven `window.open` call sites; `frontend/package.json`.
*Acceptance:* `@tauri-apps/plugin-opener` imported and used; a save dialog for document downloads. **Verified in a packaged build, not in `tauri dev`** — this is the whole point of the task.
*Tests:* a manual packaged-build checklist.

---

### Phase E — make discovery work

**TASK 021 [P0] — Formalise the source protocol** → —
*Files:* `sources/base.py`, new `sources/registry.py`, all source modules.
*Acceptance:* the `Source` protocol and `SourceResult` from §10.3. **A per-board failure is never silently dropped** — `greenhouse.py:52-54` and `lever.py:41-43` are fixed. Per-host rate limiting (20/60s sliding) and exactly one retry with jittered backoff, **zero retries on metered aggregators**. Adding a source is one line in the registry, enforced by a parity test.
*Tests:* unit tests per source against recorded fixtures — currently zero exist; a test asserting a 404 on one board surfaces in `SourceResult.error`.

**TASK 022 [P0] — European and Portuguese sources** → 021
*Files:* new `sources/boards/{remotive,arbeitnow,eures}.py`, `sources/aggregators/{adzuna,jooble}.py`, `sources/ats/{ashby,workable,smartrecruiters,recruitee,personio,teamtailor}.py`, `sources/seeds/companies_eu.yaml`.
*Acceptance:* the keyless tier works with no configuration. Adzuna and Jooble **fail closed to `ok=True, jobs=[], skipped="needs-key"`, never an error**. The seed table carries ~120 European employers with their ATS and slug, replacing the 14 US startups. **A discovery run for a Porto-based senior .NET/Angular profile returns ≥30 genuinely relevant postings** — this is the acceptance criterion that matters; if it is not met, the task is not done.
*Tests:* fixture-based parsing tests per source; one live integration test per source, skipped in CI.

**TASK 023 [P0] — Fix matching and normalisation** → 021
*Files:* `sources/base.py:183-192`, `services/normalize.py`, `sources/hackernews.py`.
*Acceptance:* keyword matching is token-based with normalisation (`full stack` ≡ `full-stack` ≡ `fullstack`) and optional synonyms. The technology vocabulary covers the .NET ecosystem (Blazor, EF Core, MAUI, Dapper, SignalR, MassTransit, xUnit, NUnit) and the modern JS/TS ecosystem (Vite, Nx, Bun, Deno, Signals, RxJS). **The salary regex requires a currency marker or an explicit salary keyword within a short window** — `"we process 30,000 - 90,000 requests"` must yield no salary, and this is a test. `detect_remote_type` checks remote before hybrid. `split_location("Berlin")` yields `city="Berlin"`. HackerNews uses `search_by_date`.
*Tests:* extend `test_units.py` with the three reproduced salary false positives as explicit regression cases.

**TASK 024 [P0] — Demo mode** → 021
*Files:* `sources/__init__.py`, `sources/sample.py`, `models/job.py`, all analytics queries, `SettingsView.tsx`.
*Acceptance:* `sample` is **off by default**; jobs carry `is_demo=True`; **every analytic, facet and funnel excludes them**; the UI badges them; a Settings toggle enables them with honest copy.
*Tests:* a test asserting analytics over a database of demo-only jobs returns zeros.

**TASK 025 [P1] — The companies table and URL resolver** → 022
*Files:* new `models/company.py`, `sources/companies.py`, `sources/resolver.py`, a migration.
*Acceptance:* the six-strategy chain from §10.4, each result carrying `resolution`. Passive harvesting learns `(name, ats, slug)` from every ingested ATS URL. `Job.application_url` is the resolved URL; unresolved routes to ACTION_REQUIRED.
*Tests:* port mr-jobs' resolver test shapes — they have 50 and they are good.

**TASK 026 [P1] — Source health** → 021
*Files:* new `models/source_health.py`, `services/discovery.py`, `JobsView.tsx`, `SettingsView.tsx`.
*Acceptance:* per-source `last_ok_at`, `consecutive_failures`, `last_error`. The UI shows a per-source chip with count, skip reason and health, and distinguishes "found nothing today" from "broken since Tuesday". The `DiscoveryResponse.partial` flag — currently computed and never read — drives a warn-tinted strip, per `DESIGN.md` §9.
*Tests:* a test asserting three consecutive failures mark a source degraded.

---

### Phase F — make automation real

**TASK 027 [P1] — The scheduler** → 009
*Files:* new `services/scheduler.py`; `main.py`; `models/automation.py`; `AutomationView.tsx`; `requirements.txt` (+ `apscheduler`).
*Acceptance:* `manual | daily | twice_daily | weekly` at a local hour/minute. Due-ness against `last_occurrence_ms` so a missed run catches up **once**, never twice. Deterministic per-install jitter in a 10-minute window. Configured outside the event loop, started inside the FastAPI lifespan. **The scheduler enqueues a task; it never runs the pipeline inline.** `schedule_cron` is either used or deleted.
*Tests:* unit tests for due-ness, catch-up-once, and jitter determinism.

**TASK 028 [P1] — Restructure the run** → 027, 009
*Files:* `services/automation.py`.
*Acceptance:* the eleven stages from §8.2. **Deterministic pre-filter before any model call.** Model scoring on the top 40 only. Every limit from §8.4 enforced, including the six currently-dead ones. A wall-clock budget ending the run `COMPLETED_PARTIAL`, never `FAILED`. Stage failures isolated. The emergency stop preserved exactly as it is.
*Tests:* the first unit tests this module has ever had — pause, resume, cancel, emergency stop, limits, budget exhaustion.

**TASK 029 [P1] — Remove the phantom submission path** → 028
*Files:* `services/applications.py`, `services/automation.py`, `api/analytics.py`, `DashboardView.tsx`, `AnalyticsView.tsx`, `README.md`, `CLAUDE.md`.
*Acceptance:* `route_for_submission` returns `READY_TO_SEND` (mailto only) or `ACTION_REQUIRED` (everything else) and the dry-run branch no longer short-circuits both. `applications_submitted` counts **user-confirmed** submissions only. The unreachable `SUBMITTED` branch is deleted. The funnel's "Prepared" stops counting all applications, and its hardcoded threshold of 70 uses `config.min_score`. **`README.md` and `CLAUDE.md` are updated in the same commit** to state that the product never submits.
*Tests:* a test asserting a non-dry-run over a source with no submission mechanism produces ACTION_REQUIRED.

**TASK 030 [P1] — State machine and transition audit** → 012
*Files:* `models/enums.py`, `models/application.py`, `api/applications.py`, `services/applications.py`.
*Acceptance:* a `LEGAL_TRANSITIONS` table; illegal transitions return 422 with the legal set. Add `GHOSTED` as a live, reopenable stage. Every transition writes an `application_events` row. `stage_history` is dual-written for one release.
*Tests:* a table-driven test over legal and illegal pairs.

**TASK 031 [P1] — Follow-up and ghost detection** → 030
*Files:* `services/applications.py`, `api/applications.py`, `DashboardView.tsx`.
*Acceptance:* `follow_up_due` set on entering SUBMITTED; a nightly scheduler job surfaces due follow-ups and marks 21-day silences `GHOSTED`; an **Action Required** dashboard card with a pre-filled draft and a copy button. `applications_submitted_today` uses the **local** day boundary, not UTC.
*Tests:* time-travel tests over the two thresholds.

---

### Phase G — make the model cheap and the answers reusable

**TASK 032 [P1] — LLM cache** → 008
*Files:* new `llm/cache.py`, `models/llm_cache.py`, `llm/ollama.py`, a migration.
*Acceptance:* content-hash keys including `prompt_version` and `model`. A second automation run over an unchanged corpus makes **zero** model calls. A cache hit is logged and visible in the run summary.
*Tests:* a test asserting the second identical call does not reach the provider.

**TASK 033 [P1] — Ollama client hardening** → 032
*Files:* `llm/ollama.py`, `llm/base.py`, `core/config.py`.
*Acceptance:* streaming enabled with tokens forwarded to task progress; timeouts 90s/150s and configurable; a semaphore of 1; one retry on transport, zero on parse; `extract_json`'s greedy fallback fixed; the profile serialised as JSON not `repr`; `num_ctx` sent per request and the `Modelfile` deleted; the default model changed to a ~8B instruct tag. **The blanket `except (LLMUnavailable, Exception)` is narrowed so a genuine bug is not swallowed as a template fallback** — and when a fallback happens, the reason reaches the UI.
*Tests:* unit tests for the JSON extractor including the two-object case; a test asserting a `TypeError` in prompt construction is not silently swallowed.

**TASK 034 [P1] — The answer knowledge base** → 013
*Files:* new `models/answer.py`, `services/answers.py`, `api/answers.py`, `ProfileView.tsx`, `ApplicationsView.tsx`, a migration.
*Acceptance:* normalised `question_key`; lookup ranked `human > profile > model`; unknown required questions generate a model draft flagged for review; the Applications answer pack renders every answer with a per-answer and a copy-all button; a Profile tab lists and edits the whole set; YAML export/import.
*Tests:* key-normalisation tests; a ranking test.

**TASK 035 [P1] — Score invalidation** → 012
*Files:* `models/job_score.py`, `services/scoring.py`, `api/jobs.py`, `JobsView.tsx`.
*Acceptance:* `formula_version` added; both versions compared on read; a stale score renders as **"needs rescoring"** and is excluded from the automation filter; a "Rescore all stale" action. The breakdown key count is unified so `test_units.py` and `smoke_workflow.py` assert the same contract.
*Tests:* a test asserting a profile edit marks existing scores stale.

---

### Phase H — make it look and feel like Windows software

**TASK 036 [P0] — Ship the fonts** → —
*Files:* `frontend/public/fonts/`, `frontend/src/styles/base.css`, `index.html`.
*Acceptance:* Inter Variable and JetBrains Mono self-hosted, `@font-face` with `font-display: block` and `font-weight: 100 900`; no network font request in a packaged build; `font-variant-numeric: tabular-nums` unconditional on `.mono`.
*Tests:* a network-panel check in a packaged build; visual verification.

**TASK 037 [P1] — Contrast tokens** → 036
*Files:* `frontend/src/styles/tokens.css`, `components.css`, `DESIGN.md`.
*Acceptance:* the three changes from §7.5. Every token pair used for text clears 4.5:1, asserted by a test. The 11 hardcoded CSS colours are tokenised; the fourth gradient at `components.css:324` is removed. **`DESIGN.md` §1 is updated in the same commit.**
*Tests:* a contrast test over every `(text, background)` pair the product actually uses.

**TASK 038 [P1] — Custom title bar and window state** → 003
*Files:* `tauri.conf.json`, `src-tauri/src/main.rs`, new `frontend/src/app/TitleBar.tsx`, `components.css`.
*Acceptance:* `decorations: false`; a 32px bar with `data-tauri-drag-region`, the app mark, the document context and custom minimise/maximise/close; size and position persisted; double-click maximises; snap works. `--titlebar-height` stops being dead.
*Tests:* visual verification at three window sizes plus a snap.

**TASK 039 [P1] — Three-pane Job Search with a resizable detail pane** → 038
*Files:* `JobsView.tsx`, `JobDetailPanel.tsx` (modal → pane), `components.css`.
*Acceptance:* `rail | list | detail`, min 380 / default 480, persisted. Arrow keys move the selection and the pane follows. The modal path is retained only for Applications.
*Tests:* visual verification; keyboard traversal.

**TASK 040 [P1] — Density and the per-row primary action** → 039
*Files:* `JobsView.tsx`, `DashboardView.tsx`, `components.css`, `ui.tsx`.
*Acceptance:* the job row is ≤52px in Comfortable and ≤40px in Compact, with a persisted toggle; a **Prepare** button in every row; ≥17 postings visible at 900px. `SkeletonRows` matches the real row height.
*Tests:* a measured screenshot at 1440×900 counting visible rows.

**TASK 041 [P1] — Dashboard hierarchy** → 040
*Files:* `DashboardView.tsx`, `components.css`.
*Acceptance:* **Quick Actions deleted** (four cards duplicating the rail, one destination twice). Recent matches becomes the dominant panel on `--surface-1` + `--shadow-card`; supporting panels demoted to bordered `--bg-app` with no shadow. **The zero-data states are preserved exactly as they are** — they are the best thing in the renderer.
*Tests:* visual verification in both the zero-data and populated states.

**TASK 042 [P1] — ErrorBoundary and real error states** → —
*Files:* new `frontend/src/app/ErrorBoundary.tsx`, `main.tsx`, `AnalyticsView.tsx`, `EmailView.tsx`, `DashboardView.tsx:441`.
*Acceptance:* an ErrorBoundary per view with a reset action. **Every `useAsync` with a `loading` branch also has an `error` branch** — a 500 never renders as an empty state. `navigate(insight.action!.view as never)` is replaced by the existing `VIEW_IDS` guard.
*Tests:* a test injecting a throwing child; route tests asserting an error state, not an empty one.

**TASK 043 [P1] — Keyboard operability** → 039
*Files:* `ApplicationsView.tsx`, `ui.tsx`, new `frontend/src/app/CommandPalette.tsx`, `Shell.tsx`.
*Acceptance:* a stage `<select>` in the application detail modal; optimistic drag (`useAsync.setData`, which exists and has never been called); `Modal` gains a focus trap and focus restoration and Escape closes only the topmost; `Tabs` gains `tabpanel`, `aria-controls` and arrow keys; an `aria-live` region for toasts; `Ctrl+K` opens a real command palette; `Ctrl+1..9`, `/`, `j`/`k`, `Ctrl+Enter`.
*Tests:* keyboard traversal of the full pipeline with no mouse; an axe-core pass.

**TASK 044 [P1] — Fix the stuck command bar and the rail collapse** → —
*Files:* `Shell.tsx`, `AppState.tsx`, `hooks.ts`.
*Acceptance:* a poll that observes a run transitioning to finished calls `invalidate()`; a periodic health poll every 30s; the rail collapse initialises from the viewport once, persists the user's toggle, and only auto-collapses crossing 1100px downward.
*Tests:* a test asserting a run completing clears the badge.

**TASK 045 [P2] — Enforce the design system** → 037
*Files:* `frontend/eslint.config.js`, new `frontend/.stylelintrc`, `package.json`.
*Acceptance:* raw `#RRGGBB` in TSX is an error; off-scale spacing literals are errors; `fontSize` outside the `.t-*` classes is an error; the existing 107 violations are fixed in the same change. `npm run lint` is added to the standing checks.
*Tests:* the lint suite itself.

---

### Phase I — release engineering

**TASK 046 [P1] — Migrate to pytest** → —
*Files:* `backend/tests/` restructured; `requirements-dev.txt`; `package.json`.
*Acceptance:* real `test_*` functions with fixtures and isolation; an in-memory SQLite fixture; a `TestClient` fixture; a stub LLM provider. **The existing 61 assertions survive as real tests** — none is lost. An exception in one test no longer skips the rest.
*Tests:* the suite.

**TASK 047 [P1] — Test the untested** → 046
*Objective:* cover the risk surface, in priority order.
*Acceptance:* route tests for all ten API modules; fixture-based tests for every source; tests for `extract_json` and `wrap_untrusted`; a test for the ±8 clamp with a stub provider; `store_document` versioning; all eight analytics functions; **`cv_import._read_pdf` and `_read_docx` against three real CVs each** — the highest-risk untested code in the repository.
*Tests:* ≥70% line coverage on `services/` and `sources/`.

**TASK 048 [P1] — Auto-updater** → 002
*Files:* `Cargo.toml`, `tauri.conf.json`, `src-tauri/src/main.rs`, `.github/workflows/release.yml`.
*Acceptance:* `tauri-plugin-updater` with a pinned minisign pubkey; `latest.json` on GitHub Releases; check 10s after launch then every 4h; an update banner the user can dismiss.
*Tests:* a manual upgrade from N-1 to N.

**TASK 049 [P2] — Code signing** → 048
*Files:* `tauri.conf.json`, the release workflow, `docs/RELEASE.md`.
*Acceptance:* signed NSIS and MSI with a timestamp; "Unknown publisher" is gone. Requires a Sponsor decision on the certificate (see §18, OD-4).

**TASK 050 [P2] — Documentation truth pass** → all
*Files:* `README.md`, `CLAUDE.md`, `DESIGN.md`, new `docs/SOURCES.md`, `docs/RELEASE.md`.
*Acceptance:* **every claim in every document is verified against the code.** No feature is described that does not exist. `CLAUDE.md` gains rule 7 (§9.1) and the invariant list. `docs/SOURCES.md` records every source, its endpoint, its legal basis and its ToS status. A CI check fails the build if `README.md` mentions a route that does not exist.

---

# 18. Risks and open decisions

## 18.1 Risks

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R-1 | **PyInstaller + WeasyPrint native dependencies fail to bundle on Windows.** WeasyPrint pulls in Pango/Cairo/GObject. | Medium | High — blocks TASK 018 | Test the bundle on a clean VM as the *first* step of TASK 018, not the last. Fallback: the Typst CLI as a second sidecar, or ReportLab with a hand-built layout (uglier, pure Python, always bundles). |
| R-2 | **An 8B local model produces poor tailoring**, even with structural assembly. | Medium | Medium | The structural design contains the damage — a weak model produces a *dull* CV, never a false one. Mitigate with per-stage model overrides and an honest "the model added little here" signal. Measure it: keep 10 fixture jobs and diff the output across models. |
| R-3 | **European source coverage still disappoints** after TASK 022. EURES quality varies; the ATS seed list may not cover Portuguese employers well. | Medium | High — it is the whole product for this user | Make TASK 022's acceptance criterion **≥30 relevant postings**, and treat a miss as a blocker, not a partial pass. Adzuna's `pt` endpoint is the fallback lever; escalate the ITJobs/Landing.jobs ToS question early. |
| R-4 | **The validator produces false positives** and blocks legitimate documents, training the user to click "Keep" on everything. | Medium | High — it destroys the guarantee | Criticals must be *precise*, not *broad*. Every false positive found in use becomes a fixture. Ship with Warnings where precision is uncertain and promote to Critical only once the fixture set proves it. The "Keep → add to profile" resolution is the pressure valve: it makes the honest path the easy one. |
| R-5 | **Scope.** This roadmap is ~50 tasks. `ai-job-hunter-app` shows where unbounded scope leads — 25 boards, 16 templates, an extension, an MCP server, and a docs set that admits it is stale. | **High** | High | Phases A–E are the MVP and nothing else ships first. Resist every source beyond the recommended set, every template beyond two, and every V2 item until V1 has been used for a month. |
| R-6 | **Gmail OAuth onboarding is heavy** (a Google Cloud project) and most users will not complete it. | High | Medium | It is V1.5 and fully optional. If completion is low, the fallback is a manual "paste the rejection email" box, which captures most of the value for none of the setup. |
| R-7 | **A source breaks silently** and the user quietly stops receiving jobs. | High (it is inevitable) | Medium | `source_health` plus the per-source UI chip. Contract tests per adapter, run weekly against live endpoints and allowed to fail loudly. Never a hand-maintained endpoint document — `ai-job-hunter-app`'s 65 KB `SCRAPING_ENDPOINTS.md` opens by admitting it is stale. |
| R-8 | **SQLite corruption** on an unclean shutdown during a write-heavy run. | Low | High | WAL is already on. Add a `PRAGMA integrity_check` at startup and an automatic backup before every migration. |
| R-9 | **The user believes the product submits applications** because the current README and dashboard imply it. | Medium | High | TASK 029 fixes the code, the copy and the docs **in one commit**. The first-run wizard says it in step 1. Settings keeps the "what this will not do" cards — they are good and they should be more prominent, not less. |

## 18.2 Open decisions for the Sponsor

| # | Decision | Options | PO recommendation |
|---|---|---|---|
| **OD-1** | **Accept the repositioning: Job Hunter prepares, the user submits.** | (a) accept; (b) insist on automated submission | **(a).** All three references prove (b) is only reachable through techniques the Sponsor himself prohibited. This is the decision everything else depends on — it should be made before TASK 001. |
| **OD-2** | **Portuguese national boards (ITJobs, Landing.jobs, Net-Empregos).** | (a) only with a permissive ToS or an official API; (b) scrape regardless; (c) skip | **(a).** Someone must read the ToS and record the finding in `docs/SOURCES.md`. If it prohibits automated access, they are out — the same rule that excludes LinkedIn. If Landing.jobs has a partner API, it is worth an email. |
| **OD-3** | **Default model.** | (a) `qwen3:8b`-class, ships to everyone; (b) keep a 30B; (c) no default, the user picks from what they have | **(a)** with (c) as an override. A 30B default excludes most machines, and the current tag does not even exist. |
| **OD-4** | **Code signing certificate.** | (a) OV (~€300/yr, SmartScreen reputation accrues over weeks); (b) EV (~€600/yr, immediate reputation, hardware token); (c) unsigned | **(a)** now, **(b)** if distribution ever goes beyond the Sponsor. (c) means a SmartScreen wall on every install forever. |
| **OD-5** | **Is this for the Sponsor alone, or for other people?** | (a) personal tool; (b) shipped product | This changes the weight of signing, updating, telemetry-free diagnostics, backup, multi-profile support and the whole first-run experience. **The roadmap above assumes (b)** because the brief says "vanilla Windows user". If it is (a), Phases A and E stay, and half of H can wait. **This is the single most valuable clarification the Sponsor can give.** |
| **OD-6** | **PDF engine.** | (a) WeasyPrint (pure Python, easy bundle, adequate typography); (b) Typst CLI (better output, a second sidecar to bundle and sign) | **(a)** for V1, (b) as a V2 upgrade if the output is not good enough. Decide only if R-1 materialises. |
| **OD-7** | **The `legacy/` directory** — 21 superseded test scripts and a duplicate backend skeleton. | (a) delete now; (b) keep | **(a).** `CLAUDE.md` says it is kept "only until the Sponsor says to drop it". This is the PO saying: drop it. It is dead weight that confuses every future search of the repository. |

---

# 19. Re-cut — personal tool (Sponsor decision, 11 Sep 2026)

**This section supersedes §18.2 and amends §14, §15, §16 and §17.** Sections 1–13 are unchanged.

The Sponsor has decided:

- **OD-1 — ACCEPTED.** The product prepares; the Sponsor submits. §1.3 stands.
- **OD-5 — PERSONAL TOOL.** Job Hunter is for the Sponsor alone. It will not be distributed.

That second decision removes about a third of the roadmap, and — more importantly — removes the riskiest task in it.

## 19.1 What "the Sponsor submits" actually means

Email is the *minority* case, not the normal one. Concretely, per application:

| Route | Share | What the Sponsor does |
|---|---|---|
| **ATS form** (Greenhouse, Lever, Ashby, Workable, Personio, Teamtailor…) | ~85% | Job Hunter opens the resolved application URL in the browser. He attaches the generated PDF, pastes the answers from the answer pack (one click copies all of them), clicks Submit, then marks the card Submitted. **≈2 minutes.** |
| **`mailto:` posting** | ~10% | Job Hunter prepares the message body and attaches the CV. He reviews and sends from his own mail client. **≈1 minute.** |
| **No documented mechanism** | ~5% | ACTION_REQUIRED. The full package is ready; he decides whether the role is worth a manual route. |

So the manual step is *form-filling with everything pre-written*, not composing emails. What the product removes is the 40 minutes of tailoring a CV, writing a letter, and re-answering the same eight screening questions — not the click.

## 19.2 The big win: PyInstaller is no longer needed

On one known machine, a one-time venv is a complete and correct answer to P0-1.

> **Correction, applied in TASK 003/004.** This section originally said that `backend.rs` already probed `backend/.venv/Scripts/python.exe` before falling back to bare `python`, and that a venv alone was therefore sufficient. That was wrong on two counts. The probe order was `backend/runtime/python.exe` first, and more importantly `bundle.resources` copied `backend/app` next to the executable, so the shell resolved the backend package to that copy and looked for the interpreter *inside it* — never at the one `scripts/setup.ps1` creates in the repository. What happens now: the backend package and the interpreter are resolved **as a pair**, taking the first location that has both, and a package with no interpreter beside it is skipped rather than accepted. `bundle.resources` has been removed, so there is no second copy of the Python source to drift from the repository. The consequence is the one this section already intends: the app runs from the repository, and an installed copy launched from anywhere else has no backend to find.

This deletes TASK 001 and TASK 002 as written, and with them **risk R-1** — bundling WeasyPrint's Pango/Cairo native dependencies into a PyInstaller one-folder build was the single most likely place for this plan to stall for days. WeasyPrint now just gets `pip install`ed into a venv, which always works.

**Replacement — TASK 001b [P0] — One-time environment setup.**
*Files:* new `scripts/setup.ps1`, `README.md`, `src-tauri/src/backend.rs`.
*Acceptance:* `scripts/setup.ps1` creates `backend/.venv`, installs `requirements.txt`, verifies imports, and prints a clear result. `python_command()` keeps the `.venv` probe, **deletes the bare `"python"` fallback**, and when no venv is found returns a typed error the diagnostic panel renders as *"Run scripts/setup.ps1 once — the local service has no Python environment."* `bundle.resources` is removed; the app runs from the repo.
*Tests:* delete `backend/.venv`, launch, and confirm the diagnostic panel says exactly that within 2 seconds — not 90.

PyInstaller returns only if the tool is ever given to someone else. It is a V2 line item, not a blocker.

## 19.3 What is deleted from the roadmap

| Dropped | Why |
|---|---|
| TASK 001, 002 (PyInstaller sidecar) | replaced by 001b above |
| TASK 048 (auto-updater) | he rebuilds from source; there is no fleet to update |
| TASK 049 (code signing) | saves ~€300/yr; he clicks through SmartScreen once, or just runs `tauri dev` |
| The six-step first-run wizard (§15.1) | the Profile screen already exists and is good. Fill it once, set targets, done. A wizard for an audience of one is ceremony. |
| Demo mode (TASK 024 as specified) | **simplify: delete `sources/sample.py` outright.** He does not need example data; he needs the 5 fake jobs out of his analytics. |
| Backup / restore / factory reset | a scheduled `copy` of `%LOCALAPPDATA%\JobHunter\jobhunter.db` is the whole feature |
| Full WCAG / axe / screen-reader work (most of TASK 043) | **keep** the contrast token fix (3 lines, pure readability) and **keep** keyboard operability (that is speed, not accessibility). **Drop** `aria-live`, focus traps, `tabpanel` wiring, axe in CI. |
| Multi-profile support | one profile |
| macOS build | one Windows machine |

## 19.4 What gets *more* important, not less

For an audience of one the value concentrates:

1. **European and Portuguese sources (TASK 022).** This is now essentially the entire product. A Job Hunter that cannot find Porto and remote-EU .NET roles is worth nothing to its only user, no matter how good everything else is. It is the acceptance test for the whole project: **≥30 genuinely relevant postings in one run.**
2. **Truthfulness (TASK 014–017).** Unchanged in priority. It is his name and his professional reputation on every document — being the only user makes this *more* personal, not less.
3. **The answer knowledge base (TASK 034).** Compounding value is maximal for one person applying repeatedly. After twenty applications he never types "notice period" again.
4. **The scheduler (TASK 027).** He works full time at Natixis. The product's job is to have already run at 08:00 before he opens it in the evening.
5. **Logging and the diagnostic panel (TASK 004, 005).** When it breaks he is the only person who can fix it, and the backend is not his specialism. The log is the difference between a five-minute fix and a lost evening.

## 19.5 The remaining five decisions, closed by the PO

Per the standing rule that the PO decides what the PO can decide. This section closes the **decisions**; carrying each one out belongs to the task named beside it, so a decision recorded here and not yet visible in the repository is work outstanding rather than a contradiction:

| # | Decision | Closed as |
|---|---|---|
| OD-2 | Portuguese national boards | **Deferred, not rejected.** Adzuna's `pt` endpoint (official API, free tier) goes into TASK 022 and covers a meaningful slice of the same inventory legitimately. ITJobs / Landing.jobs / Net-Empregos are revisited *after* TASK 022 ships, and only if the ≥30-relevant-postings bar is missed. If revisited, the first step is checking for an official API or feed — at ten requests a day on a personal tool the practical exposure is an IP block rather than anything legal, but the honest route is still the route we take first. |
| OD-3 | Default model | **~8B instruct at `num_ctx 16384`, with a per-stage override.** If the Sponsor's GPU comfortably runs the 30B he pins it to `cover_letter` and `tailor_cv` in Settings and leaves scoring on the 8B — best of both, and it costs nothing to support. The `Modelfile` is deleted; `num_ctx` goes per request. |
| OD-4 | Code signing | **Dropped.** |
| OD-6 | PDF engine | **WeasyPrint.** With PyInstaller gone this is a plain `pip install` and carries no packaging risk. Typst stays a V2 upgrade if the output disappoints. |
| OD-7 | The `legacy/` directory | **Delete it.** 21 superseded test scripts and a duplicate backend skeleton that confuse every search of the repository. |

Nothing is now blocked on the Sponsor. Phase A can start.

## 19.6 Revised MVP

Nine work items. Everything else waits.

| # | Task | Why it is in the MVP |
|---|---|---|
| 001b | One-time venv setup + typed "no environment" error | the app starts, or says precisely why |
| 003 | Show the window immediately + startup state | no more 90 seconds of nothing |
| 004 | Backend logs to disk | failures become fixable |
| 005 | Diagnostic panel in Settings | one honest screen instead of ten identical errors |
| 008 | Alembic | the only defect that cannot be retrofitted once there is real data |
| 013–017 | Structured bullets → validator → cover letters → structural assembly → export gate | the core promise becomes true |
| 018–019 | Document model + WeasyPrint PDF + python-docx DOCX | the output becomes attachable |
| 021–024 | Source protocol, EU/PT sources, matching and normalisation fixes, delete `sample` | **there are finally jobs worth applying to** |
| 036 | Ship Inter + JetBrains Mono | every typographic decision in `DESIGN.md` is currently unrealised |

Then V1 as written in §16, minus the dropped items in §19.3.

**Amendment to the Appendix below:** line 3 no longer reads "a clean Windows VM with no Python". For a personal tool the acceptance environment is *the Sponsor's machine with `backend/.venv` deleted* — the app must fail in under two seconds with an instruction, never in ninety with silence.

## 19.7 Keeping the door open — "personal for now, maybe distributed later"

The Sponsor has flagged that distribution is possible one day. **Nothing in §19.3 burns that bridge** — every dropped item is configuration, CI or a localised component change that can be added in a week. But that is only true if four disciplines are kept from day one. Three of them cost nothing now and are expensive or impossible to retrofit.

**Rule 1 — Nothing about the Sponsor goes in the code.** No hardcoded city, country, stack, seniority, employer, name, salary floor or language anywhere in a Python or TypeScript file. Every one of those comes from the candidate profile or the automation config. This is the exact failure that makes ApplyPilot un-distributable: `scorer.SCORE_PROMPT_TEMPLATE` hardcodes *"The candidate is US-based (Seattle, WA)"* and *"the candidate's exact stack (Go/Kotlin/Python/Java…)"*, and `_INELIGIBLE_TITLE_PATTERNS` bakes in one person's seniority preferences and a Costco-specific retail list — while the CHANGELOG claims the scoring prompt is profile-driven. It is the single easiest trap to fall into when the only user is the person writing the brief, and it is the hardest to unpick afterwards because the assumptions are invisible until someone else runs it. **Source seed lists live in YAML, not in Python constants**, for the same reason.

**Rule 2 — Stay PyInstaller-compatible even though we are not using it.** Cost now: close to zero. Cost later if ignored: a packaging rewrite.
- No dynamic or conditional imports a freezer cannot trace — the source registry is an explicit import list, never `importlib` over a directory.
- Every data path (templates, fonts, YAML seeds) resolves through **one** `resource_path()` helper, never from `__file__` walking up the repo.
- Nothing at runtime assumes the repository layout — the data directory is already `%LOCALAPPDATA%\JobHunter`, which is correct; keep it that way.
- `requirements.txt` stays the single source of dependency truth. No `pip install` improvised into a script.

**Rule 3 — Every dialog, tab set and toast goes through `ui.tsx`.** The a11y work dropped in §19.3 (`aria-live`, focus traps, `tabpanel` wiring) is cheap to add later *only because* `Modal`, `Tabs` and the toast stack are centralised. The moment a view hand-rolls its own overlay, that work becomes a scavenger hunt across 5,100 lines. Keep the component library the only path.

**Rule 4 — Deferred, not deleted.** TASK 048 (updater), TASK 049 (signing), the first-run wizard and the full a11y pass move to a **"V2 — if distributed"** bucket in the roadmap rather than being struck out, so the decision is revisited deliberately rather than rediscovered. Demo mode comes back with them; `sources/sample.py` is deleted now, and its five fixtures are worth about an hour to rewrite if that day comes.

**What is genuinely one-way, and therefore stays in the MVP regardless:** Alembic (§5, P0-7) and the structural truthfulness work (§9.3). Migrations cannot be retrofitted once there is a database with real data in it — his or anyone's. And a document pipeline where the model writes prose cannot be made truthful later without rewriting the pipeline; a pipeline where Python assembles from profile fields is truthful by construction from the first commit.

---

## Appendix — the seven-line brief for the Developer agent

If only one thing from this document is read, read this.

1. **The model never originates a fact.** It selects, orders and rephrases; Python assembles every document from profile fields. Prove it with fixtures.
2. **Deterministic first, inference on a shortlist, cached.** A second run over unchanged data must cost zero model calls.
3. **Nothing that cannot be installed is done.** A clean Windows VM with no Python is the acceptance environment for every packaging task.
4. **A degraded result is named, never hidden.** A failed source, a skipped board, a template fallback, a stale score, a missing model — all visible, all labelled.
5. **Never document a feature that does not exist.** If a capability is removed, the README and `CLAUDE.md` change in the same commit.
6. **No screen ships without being seen running.** Screenshot it in a real window. Tests, lint and a green build are not evidence of design.
7. **The product never submits an application.** Everything is prepared, nothing is sent.
