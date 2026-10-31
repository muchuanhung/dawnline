"""favorites：使用者收藏的路線（公開路線，或自己的私人路線）

PK (user_id, route_id) 讓重複收藏變成冪等；(user_id, created_at) 給「我的收藏」依時間排序。
使用者或路線刪除時一起刪（路線是軟刪除，service 會另外清掉收藏）。

Revision ID: 0007
Revises: 0006
Create Date: 2026-10-31
"""

from alembic import op

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
CREATE TABLE favorites (
  user_id    BIGINT UNSIGNED NOT NULL,
  route_id   BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (user_id, route_id),
  KEY idx_favorites_user_created (user_id, created_at),
  KEY idx_favorites_route (route_id),
  CONSTRAINT fk_favorites_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_favorites_route FOREIGN KEY (route_id) REFERENCES routes(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
""")


def downgrade() -> None:
    op.execute("DROP TABLE favorites")
