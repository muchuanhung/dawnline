"""routes 加 route_type（自行車／跑步／健行／雪巴運動，上傳時由 GPX 判斷）

Revision ID: 0005
Revises: 0004
Create Date: 2026-10-17
"""

from alembic import op

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE routes ADD COLUMN route_type VARCHAR(20) NOT NULL DEFAULT '自行車' AFTER name"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE routes DROP COLUMN route_type")
