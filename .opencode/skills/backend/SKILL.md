---
name: backend
description: Where the backend conventions live, and the few that are not written down elsewhere.
---

`CLAUDE.md` and `docs/BLUEPRINT.md` §6.2 hold the stack, the layout and the
rules. Read them rather than a summary.

What is easy to get wrong and worth stating twice:

- **One declarative base.** Every model imports `Base` from `app/db/base.py`.
  A second base removes those tables from `create_all`, which is how the first
  version shipped an empty database file.
- **SQLite, not PostgreSQL.** There is no `ARRAY`; list and dict fields use `JSON`.
- **Route handlers stay thin.** The domain lives in `app/services`.
- **Model output is parsed and stored, never executed**, never used to build a
  path or a command, and never allowed to decide what the application does next.
- **No credentials in the database.** A row stores the *name* of an entry in the
  OS credential store, and the API rejects a payload carrying a password rather
  than dropping it silently.
- **Every data path goes through one `resource_path()` helper**, never `__file__`
  walking up the repository. The source registry is an explicit import list,
  never `importlib` over a directory. Both are blueprint §19.7 rule 2.

Tests are `backend/tests/test_units.py`, run as a plain script through
`npm run test:backend`. There is no pytest in this project.
