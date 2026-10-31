"""routes 加 visibility 與 slug：公開路線（原 Firebase Storage gpx/routes）搬進同一張表

- visibility：private（使用者上傳，算配額）／public（所有人可看，由匯入腳本寫入）
- slug：公開路線對外 id，沿用原本的 GPX 檔名，前端網址、Firestore 判讀輸入的 key 都不變；
  私人路線為 NULL（對外仍用 public_id）。MySQL 的 UNIQUE 允許多個 NULL。

Revision ID: 0006
Revises: 0005
Create Date: 2026-10-31
"""

from alembic import op

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
ALTER TABLE routes
  ADD COLUMN visibility ENUM('private','public') NOT NULL DEFAULT 'private' AFTER route_type,
  ADD COLUMN slug VARCHAR(64) NULL AFTER visibility,
  ADD UNIQUE KEY uq_routes_slug (slug),
  ADD KEY idx_routes_public_list (visibility, deleted_at, name)
""")


def downgrade() -> None:
    op.execute("""
ALTER TABLE routes
  DROP INDEX idx_routes_public_list,
  DROP INDEX uq_routes_slug,
  DROP COLUMN slug,
  DROP COLUMN visibility
""")
