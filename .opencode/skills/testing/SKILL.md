---
name: testing
description: Testing and regression standards for the Job Hunter application.
---

Test important business logic.

Backend:
- pytest
- unit tests
- integration tests where useful

Frontend:
- component tests where appropriate
- end-to-end tests for critical flows

Prioritize:
- job scoring
- normalization
- deduplication
- application states
- document generation
- validation
- email template rendering

When fixing bugs:
- reproduce
- fix
- add regression test
- rerun tests

Never remove a failing test merely to make the suite pass.