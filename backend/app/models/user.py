from datetime import datetime

from sqlalchemy import String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base, utcnow
from app.core.types import DateTime3, UBigInt


class User(Base):
    __tablename__ = "users"
    __table_args__ = (UniqueConstraint("firebase_uid", name="uq_users_firebase_uid"),)

    id: Mapped[int] = mapped_column(UBigInt, primary_key=True, autoincrement=True)
    firebase_uid: Mapped[str] = mapped_column(String(128))
    email: Mapped[str | None] = mapped_column(String(255))
    display_name: Mapped[str | None] = mapped_column(String(100))
    # S3 key of the uploaded avatar (users/{id}/avatar/{ulid}.jpg);
    # NULL = none, the frontend falls back to the Google photo or initials
    avatar_key: Mapped[str | None] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime3, default=utcnow)
    last_login_at: Mapped[datetime] = mapped_column(DateTime3, default=utcnow)
