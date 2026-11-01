from typing import Annotated

from fastapi import APIRouter, Depends, Response, status
from fastapi.responses import RedirectResponse

from app.deps import AppSettings, CurrentUser, DbSession
from app.schemas.route import RouteOrderIn, RouteOrderOut
from app.schemas.user import AvatarConfirm, AvatarUploadCreate, AvatarUploadOut, UserOut
from app.services import avatar_service, route_order_service
from app.services.storage import GpxStorage, get_storage

router = APIRouter(prefix="/api/v1", tags=["me"])

Storage = Annotated[GpxStorage, Depends(get_storage)]

# 頭像檢視：presigned URL 有效 1 小時；瀏覽器把轉址結果快取 5 分鐘（網址帶 ?v=，換圖就換網址）
AVATAR_VIEW_EXPIRES_SECONDS = 3600
AVATAR_REDIRECT_MAX_AGE = 300


@router.get("/me", response_model=UserOut)
def get_me(user: CurrentUser):
    return user


@router.post(
    "/me/avatar/uploads", response_model=AvatarUploadOut, status_code=status.HTTP_201_CREATED
)
def create_avatar_upload(
    body: AvatarUploadCreate, user: CurrentUser, settings: AppSettings, storage: Storage
):
    """第 1 步：發 presigned POST（只收 image/jpeg、大小上限 avatar_max_bytes）。"""
    upload_id, presigned = avatar_service.create_upload(user, storage, settings, body.file_size)
    return AvatarUploadOut(
        upload_id=upload_id,
        url=presigned.url,
        fields=presigned.fields,
        max_bytes=settings.avatar_max_bytes,
    )


@router.put("/me/avatar", response_model=UserOut)
def confirm_avatar(
    body: AvatarConfirm, user: CurrentUser, db: DbSession, settings: AppSettings, storage: Storage
):
    """第 2 步：檔案已傳到 S3，檢查是 JPEG 後換成新頭像、刪掉舊檔。"""
    user = avatar_service.confirm_upload(db, user, storage, settings, body.upload_id)
    db.commit()
    return user


@router.delete("/me/avatar", status_code=status.HTTP_204_NO_CONTENT)
def delete_avatar(user: CurrentUser, db: DbSession, storage: Storage) -> Response:
    avatar_service.delete_avatar(db, user, storage)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/me/avatar")
def view_avatar(user: CurrentUser, storage: Storage) -> RedirectResponse:
    """302 到短效 presigned URL；bucket 是私有的，<img src="/api/v1/me/avatar?v=..."> 可直接用。"""
    url = avatar_service.view_url(user, storage, AVATAR_VIEW_EXPIRES_SECONDS)
    return RedirectResponse(
        url,
        status_code=status.HTTP_302_FOUND,
        headers={"Cache-Control": f"private, max-age={AVATAR_REDIRECT_MAX_AGE}"},
    )


@router.get("/me/route-order", response_model=RouteOrderOut)
def get_route_order(user: CurrentUser, db: DbSession):
    """「我的路線」自訂順序；沒排過回空陣列（前端用預設順序）。"""
    return RouteOrderOut(ids=route_order_service.get_order(db, user))


@router.put("/me/route-order", response_model=RouteOrderOut)
def put_route_order(body: RouteOrderIn, user: CurrentUser, db: DbSession):
    """整份取代；回傳實際存下的順序（看不到的路線已略過）。"""
    ids = route_order_service.set_order(db, user, body.ids)
    db.commit()
    return RouteOrderOut(ids=ids)
