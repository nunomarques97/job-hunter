"""Record when a source last listed a posting

Nullable, and so null on every row that already exists. That is the true
answer for them: nothing was ever recorded, and a posting nobody has re-checked
is not the same thing as a posting known to be gone. Filling them in with the
time of the migration would invent a fact.

Revision ID: 0002_job_last_seen_at
Revises: 0001_baseline
Created: 2026-09-12
"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = '0002_job_last_seen_at'
down_revision: str | None = '0001_baseline'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table('jobs', schema=None) as batch_op:
        batch_op.add_column(sa.Column('last_seen_at', sa.DateTime(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('jobs', schema=None) as batch_op:
        batch_op.drop_column('last_seen_at')
