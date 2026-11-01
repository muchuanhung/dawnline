from datetime import timedelta
from typing import Annotated

from fastapi import Depends, Request, Response
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.core.cookies import set_session_cookie
from app.core.db import get_db
from app.core.errors import ApiError
from app.models import User
from app.services import auth_service

DbSession = Annotated[Session, Depends(get_db)]
AppSettings = Annotated[Settings, Depends(get_settings)]


def get_current_user(
    request: Request, response: Response, db: DbSession, settings: AppSettings
) -> User:
    """讀 session cookie 取得目前會員；成功時滑動延長 session 與 cookie。"""
    raw_token = request.cookies.get(settings.session_cookie_name)
    ttl = timedelta(days=settings.session_ttl_days)
    session = auth_service.resolve_session(db, raw_token, ttl)
    if session is None:
        raise ApiError(401, "unauthenticated", "尚未登入或登入已過期")
    db.commit()
    set_session_cookie(response, raw_token, settings)
    return session.user


CurrentUser = Annotated[User, Depends(get_current_user)]


def get_admin_user(user: CurrentUser, settings: AppSettings) -> User:
    """Admin-only endpoints; the frontend hides the buttons, this is the real gate."""
    if not settings.is_admin(user.firebase_uid):
        raise ApiError(403, "forbidden", "只有管理員可以操作")
    return user


AdminUser = Annotated[User, Depends(get_admin_user)]
