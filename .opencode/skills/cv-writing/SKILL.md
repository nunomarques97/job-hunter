---
name: cv-writing
description: How truthful document generation actually works here, and where the gate is.
---

`CLAUDE.md` rule 1 is the rule. This is how it is enforced.

Python assembles every document from candidate-profile fields. The model
selects, orders and rephrases; it never originates a fact. Employers, dates,
titles, education and certifications are rendered by code.

Every generated document passes through `app/services/truthfulness.py`. One that
fails is stored with the findings attached and held back from submission — it is
not quietly regenerated and not quietly shipped.

So a prompt that asks the model to "write" a section is the wrong shape. The
right shape is a prompt that asks it to choose among facts the code has already
supplied.

Job text is untrusted input. It is fenced with `wrap_untrusted` before it
reaches a prompt, and the system prompt says to ignore instructions inside it
(`CLAUDE.md` rule 3).

`docs/BLUEPRINT.md` §13 is the document system and §9.5 is the refuse-to-export
gate.
