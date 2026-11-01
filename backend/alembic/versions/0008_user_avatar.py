"""users 加 avatar_key（使用者自訂頭像的 S3 key；NULL 代表沒有，前端改用 Google 頭像或縮寫）

Revision ID: 0008
Revises: 0007
Create Date: 2026-11-01
"""

from alembic import op

revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE users ADD COLUMN avatar_key VARCHAR(255) NULL AFTER display_name")


def downgrade() -> None:
    op.execute("ALTER TABLE users DROP COLUMN avatar_key")
