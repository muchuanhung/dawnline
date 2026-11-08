"""登入、session 查詢與登出。router 只負責 HTTP，邏輯都在這裡。"""

import hashlib
import secrets
from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.db import utcnow
from app.core.firebase import FirebaseIdentity
from app.models import AuthSession, User


def hash_token(raw_token: str) -> str:
    # utf-8：cookie 被竄改成非 ASCII 時只會查不到（401），不會 UnicodeEncodeError 變 500
    return hashlib.sha256(raw_token.encode("utf-8")).hexdigest()


def _clip(value: str | None, limit: int) -> str | None:
    return value[:limit] if value else None


def upsert_user(db: Session, identity: FirebaseIdentity) -> User:
    """以 firebase_uid upsert，並更新 email、名稱與 last_login_at。"""
    now = utcnow()
    user = db.scalar(select(User).where(User.firebase_uid == identity.uid))
    if user is None:
        user = User(firebase_uid=identity.uid, created_at=now)
        try:
            with db.begin_nested():
                db.add(user)
        except IntegrityError:
            # 同一使用者併發首次登入：另一個請求先插入了
            user = db.scalar(select(User).where(User.firebase_uid == identity.uid))
            if user is None:
                raise
    user.email = _clip(identity.email, 255)
    user.display_name = _clip(identity.display_name, 100)
    user.last_login_at = now
    db.flush()
    return user


def create_session(db: Session, user: User, ttl: timedelta, user_agent: str | None) -> str:
    """建立 session，回傳 cookie 原值（只出現在回應裡，不入庫）。"""
    raw_token = secrets.token_urlsafe(32)
    now = utcnow()
    db.add(
        AuthSession(
            token_hash=hash_token(raw_token),
            user_id=user.id,
            created_at=now,
            expires_at=now + ttl,
            user_agent=_clip(user_agent, 255),
        )
    )
    db.flush()
    return raw_token


def resolve_session(
    db: Session, raw_token: str | None, ttl: timedelta
) -> tuple[AuthSession, bool] | None:
    """查有效 session；無 cookie、過期、已登出都回 None。

    剩不到一半效期才滑動延長（回傳的 bool 為 True，呼叫端要 commit 並重設 cookie），
    避免每個請求都寫一次資料庫；仍在使用的 session 不會過期。
    """
    if not raw_token:
        return None
    session = db.get(AuthSession, hash_token(raw_token))
    now = utcnow()
    if session is None or session.revoked_at is not None or session.expires_at <= now:
        return None
    if session.expires_at - now >= ttl / 2:
        return session, False
    session.expires_at = now + ttl
    db.flush()
    return session, True


def revoke_session(db: Session, raw_token: str | None) -> None:
    if not raw_token:
        return
    session = db.get(AuthSession, hash_token(raw_token))
    if session is not None and session.revoked_at is None:
        session.revoked_at = utcnow()
        db.flush()
