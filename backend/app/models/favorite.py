"""使用者收藏的路線：公開路線，或自己的私人路線。"""

from datetime import datetime

from sqlalchemy import ForeignKey, Index
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base, utcnow
from app.core.types import DateTime3, UBigInt
from app.models.route import Route


class Favorite(Base):
    __tablename__ = "favorites"
    __table_args__ = (
        Index("idx_favorites_user_created", "user_id", "created_at"),
        Index("idx_favorites_route", "route_id"),
    )

    user_id: Mapped[int] = mapped_column(
        UBigInt,
        ForeignKey("users.id", name="fk_favorites_user", ondelete="CASCADE"),
        primary_key=True,
    )
    route_id: Mapped[int] = mapped_column(
        UBigInt,
        ForeignKey("routes.id", name="fk_favorites_route", ondelete="CASCADE"),
        primary_key=True,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime3, default=utcnow)

    route: Mapped[Route] = relationship(lazy="joined")
