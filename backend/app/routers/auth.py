from datetime import timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, Request, Response, status

from app.core.cookies import clear_session_cookie, set_session_cookie
from app.core.errors import ApiError
from app.core.firebase import InvalidIdTokenError, TokenVerifier, get_token_verifier
from app.deps import AppSettings, DbSession
from app.schemas.auth import SessionCreate
from app.schemas.user import UserOut, user_out
from app.services import auth_service

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])


@router.post("/session", response_model=UserOut)
def create_session(
    body: SessionCreate,
    request: Request,
    response: Response,
    db: DbSession,
    settings: AppSettings,
    verify: Annotated[TokenVerifier, Depends(get_token_verifier)],
):
    """用 Firebase ID token 登入：驗證 → upsert user → 建 session → 設 HttpOnly cookie。"""
    try:
        identity = verify(body.id_token)
    except InvalidIdTokenError as e:
        raise ApiError(401, "unauthenticated", "ID token 驗證失敗") from e

    user = auth_service.upsert_user(db, identity)
    raw_token = auth_service.create_session(
        db,
        user,
        ttl=timedelta(days=settings.session_ttl_days),
        user_agent=request.headers.get("user-agent"),
    )
    db.commit()
    set_session_cookie(response, raw_token, settings)
    return user_out(user, settings.is_admin(user.firebase_uid))


@router.delete("/session", status_code=status.HTTP_204_NO_CONTENT)
def delete_session(request: Request, db: DbSession, settings: AppSettings) -> Response:
    """登出：寫入 revoked_at 並清 cookie。沒帶 cookie 也回 204，可重複呼叫。"""
    auth_service.revoke_session(db, request.cookies.get(settings.session_cookie_name))
    db.commit()
    response = Response(status_code=status.HTTP_204_NO_CONTENT)
    clear_session_cookie(response, settings)
    return response
