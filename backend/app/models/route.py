"""路線（一檔會員上傳的 GPX）。期初只建表，API 在期中實作。"""

from datetime import datetime
from decimal import Decimal

from sqlalchemy import CHAR, DECIMAL, Enum, ForeignKey, Index, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base, utcnow
from app.core.types import DateTime3, Geometry, UBigInt, UInt


class Route(Base):
    __tablename__ = "routes"
    __table_args__ = (
        UniqueConstraint("public_id", name="uq_routes_public_id"),
        Index("idx_routes_user_list", "user_id", "deleted_at", "created_at"),
        Index("sp_routes_bbox", "bbox", mysql_prefix="SPATIAL"),
    )

    id: Mapped[int] = mapped_column(UBigInt, primary_key=True, autoincrement=True)
    public_id: Mapped[str] = mapped_column(CHAR(26))  # ULID，對外只用這個
    user_id: Mapped[int] = mapped_column(UBigInt, ForeignKey("users.id", name="fk_routes_user"))
    name: Mapped[str] = mapped_column(String(100))
    # 自行車／跑步／健行／雪巴運動（與前端 Route["type"] 相同），上傳時由 GPX 判斷
    route_type: Mapped[str] = mapped_column(String(20), default="自行車")
    s3_key: Mapped[str] = mapped_column(String(255))
    file_size: Mapped[int] = mapped_column(UInt)
    file_sha256: Mapped[str] = mapped_column(CHAR(64))
    status: Mapped[str] = mapped_column(
        Enum("processing", "ready", "failed", name="route_status"), default="processing"
    )
    distance_km: Mapped[Decimal | None] = mapped_column(DECIMAL(7, 2))
    elevation_gain_m: Mapped[int | None] = mapped_column(Integer)
    bbox: Mapped[bytes] = mapped_column(Geometry("POLYGON"))
    created_at: Mapped[datetime] = mapped_column(DateTime3, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime3, default=utcnow, onupdate=utcnow)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime3)
