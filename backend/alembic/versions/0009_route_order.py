"""route_order：使用者自訂的「我的路線」順序（收藏＋自己上傳的路線，跨裝置同步）

PK (user_id, route_id)：一條路線在一個人的順序裡只出現一次；
(user_id, position) 給讀取時依順序排；route_id 索引給外鍵與刪路線時清理。
整份順序由 PUT 整批取代，所以 position 不留空位、也不需要唯一約束。

Revision ID: 0009
Revises: 0008
Create Date: 2026-11-01
"""

from alembic import op

revision = "0009"
down_revision = "0008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
CREATE TABLE route_order (
  user_id  BIGINT UNSIGNED NOT NULL,
  route_id BIGINT UNSIGNED NOT NULL,
  position SMALLINT UNSIGNED NOT NULL,
  PRIMARY KEY (user_id, route_id),
  KEY idx_route_order_user_position (user_id, position),
  KEY idx_route_order_route (route_id),
  CONSTRAINT fk_route_order_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_route_order_route FOREIGN KEY (route_id) REFERENCES routes(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
""")


def downgrade() -> None:
    op.execute("DROP TABLE route_order")
