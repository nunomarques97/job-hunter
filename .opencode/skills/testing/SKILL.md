---
name: testing
description: The suites this project actually has, and how to use them.
---

```
npm run test:backend    # offline unit tests, no network, no model, no server
npm run typecheck       # tsc over the renderer
npm run test:smoke      # end-to-end checks against a running API
cargo test --manifest-path src-tauri/Cargo.toml    # the desktop shell
```

Every change should leave all four green, and "green" means the output is in the
message. `CLAUDE.md` forbids reporting done without it.

Backend tests are plain scripts under `backend/tests`, not pytest. The smoke
test is written to pass against a database that already holds data, so it can be
pointed at a real installation.

What is worth testing first, because it is what the product promises: scoring,
normalisation, deduplication, truthfulness validation, document generation, and
the application state machine.

When fixing a bug, reproduce it before you fix it. A fix without a reproduction
is a guess, and the regression test writes itself once the reproduction exists.

Never delete a failing test to make a suite pass.
