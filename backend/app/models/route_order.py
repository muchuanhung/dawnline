"""使用者自訂的「我的路線」順序（今日判讀切換列與「全部 N 條」清單）。"""

from sqlalchemy import ForeignKey, Index
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.core.types import UBigInt, USmallInt


class RouteOrder(Base):
    __tablename__ = "route_order"
    __table_args__ = (
        Index("idx_route_order_user_position", "user_id", "position"),
        Index("idx_route_order_route", "route_id"),
    )

    user_id: Mapped[int] = mapped_column(
        UBigInt,
        ForeignKey("users.id", name="fk_route_order_user", ondelete="CASCADE"),
        primary_key=True,
    )
    route_id: Mapped[int] = mapped_column(
        UBigInt,
        ForeignKey("routes.id", name="fk_route_order_route", ondelete="CASCADE"),
        primary_key=True,
    )
    # 0 起算；整份順序每次整批取代，不需要留空位
    position: Mapped[int] = mapped_column(USmallInt)
