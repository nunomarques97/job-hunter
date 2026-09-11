---
name: frontend
description: What the renderer is built from, and the two rules that are not obvious from the code.
---

`DESIGN.md` is the design system. `docs/BLUEPRINT.md` §7 is the UX direction and
§2.13 is the standing list of renderer defects. Read those.

Two things that are not obvious from reading the code:

- **There is no Tailwind and no component library.** The design system is the
  hand-written token set in `frontend/src/styles/`, and `tokens.css` is a
  pixel-verified transcription of `DESIGN.md`. Use the tokens; do not add a
  styling dependency. The renderer has no runtime dependency beyond React, and
  the router, icons and charts are all local.
- **Every dialog, tab set and toast goes through `ui.tsx`.** That is what keeps
  the deferred accessibility work cheap to add later (blueprint §19.7 rule 3).

Every screen handles loading, empty, error and success as four distinct states,
and an error is never rendered as an empty state.

This is a desktop window, not a responsive web page. The target is 1440×900 with
a 1024 minimum.

`npm run typecheck` must pass, and the screen must be looked at in a real window
before it is called done.
