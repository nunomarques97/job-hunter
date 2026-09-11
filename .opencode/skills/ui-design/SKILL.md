---
name: ui-design
description: Pointer to the design system, and the specific gaps the blueprint has already measured.
---

`DESIGN.md` is the design system: the palette, the type scale, the 4px spacing
grid and the component specs. It is the source of truth, and `tokens.css` is a
verified transcription of it. Do not restate it and do not work around it.

`docs/BLUEPRINT.md` §7 is the UX direction — "Midnight Command" stays — and
§2.13 lists the measured gaps between the spec and what ships: off-scale spacing
values, type sizes outside the table, and contrast failures with the numbers.
Those are the work, not a matter of taste.

Two decisions already taken, so they are not reopened:

- The contrast token fix and keyboard operability are in scope.
- The wider accessibility pass — `aria-live`, focus traps, `tabpanel` wiring,
  axe in CI — is deferred (§19.3). It stays cheap to add only because every
  dialog, tab set and toast goes through `ui.tsx`.

This is a desktop window at 1440×900 with a 1024 minimum. There is no mobile
target and no landing page in this product.

Respect `prefers-reduced-motion`. Never let an effect cost legibility.

No screen ships without being seen running in a real window.
