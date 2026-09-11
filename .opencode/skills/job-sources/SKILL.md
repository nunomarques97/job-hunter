---
name: job-sources
description: What a source connector may do, and the shape every one of them takes.
---

`docs/BLUEPRINT.md` §10 is the source set, the source architecture and the URL
resolver. `CLAUDE.md` rule 2 is what a source may do. Read both.

The parts worth having in front of you:

- Prefer an official API or a documented feed. If neither exists, check for one
  before writing anything else.
- `SourceCapabilities.can_submit` states the truth for the source. It is false
  almost everywhere. Nothing here fills a third-party form, drives a logged-in
  session, evades a rate limit, or works around any access control.
- When there is no documented submission mechanism, the package is prepared in
  full, the application URL is kept, and the application is routed to
  ACTION_REQUIRED.
- Seed lists live in YAML, not in Python constants (§19.7 rule 1).
- Free-form tags feed technology detection through the vocabulary in
  `services/normalize.py`. They are never trusted as technologies, or the
  filters fill up with "digital nomad" and "exec".
- A failed source is named in the result. A partial run says it is partial
  (`CLAUDE.md` rule 4).

Every connector normalises into the canonical `Job` model and runs through
`services/dedupe.py`.
