---
name: backend
description: Backend development standards for FastAPI, SQLAlchemy, Pydantic, testing and service architecture.
---

Use Python 3.12+.

Use:
- FastAPI
- Pydantic
- SQLAlchemy
- Alembic
- SQLite
- pytest
- httpx

Keep API handlers thin.

Use service classes/functions for business logic.

Validate external data.

Validate structured LLM output with Pydantic.

Keep integrations isolated.

Never hard-code secrets.

Write tests for business-critical behavior.

Prefer clear, boring, maintainable code over unnecessary abstraction.