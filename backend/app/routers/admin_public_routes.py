"""管理員在網站上新增／下架公開路線（取代到 EC2 跑 import_public_routes 的日常操作）。

管理員由 ADMIN_FIREBASE_UIDS 決定；非管理員一律 403。上傳流程與私人路線相同：
POST /uploads 拿 presigned POST → 瀏覽器直傳 S3 → POST 完成（後端解析並寫入公開路線）。
"""

from typing import Annotated

from fastapi import APIRouter, Depends, Response, status

from app.deps import AdminUser, AppSettings, DbSession
from app.routers.public_routes import public_route_out
from app.schemas.route import (
    AdminPublicRouteCreate,
    AdminPublicRouteResult,
    UploadCreate,
    UploadOut,
)
from app.services import public_route_service
from app.services.storage import GpxStorage, get_storage

router = APIRouter(prefix="/api/v1/admin/public-routes", tags=["admin"])

Storage = Annotated[GpxStorage, Depends(get_storage)]


@router.post("/uploads", response_model=UploadOut, status_code=status.HTTP_201_CREATED)
def create_upload(body: UploadCreate, user: AdminUser, settings: AppSettings, storage: Storage):
    """第 1 步：發 presigned POST（不算配額）。"""
    upload_id, presigned = public_route_service.create_admin_upload(
        user, storage, settings, body.file_size
    )
    return UploadOut(
        upload_id=upload_id,
        url=presigned.url,
        fields=presigned.fields,
        max_bytes=settings.gpx_max_bytes,
    )


@router.post("", response_model=AdminPublicRouteResult)
def complete_upload(
    body: AdminPublicRouteCreate,
    user: AdminUser,
    db: DbSession,
    settings: AppSettings,
    storage: Storage,
):
    """第 2 步：新增或覆寫同 slug 的公開路線（收藏與網址保留）。"""
    result, route = public_route_service.complete_admin_upload(
        db, user, storage, settings, body.upload_id, body.slug
    )
    db.commit()
    return AdminPublicRouteResult(action=result.action, route=public_route_out(route))


@router.delete("/{slug}", status_code=status.HTTP_204_NO_CONTENT)
def unpublish(slug: str, _: AdminUser, db: DbSession, storage: Storage) -> Response:
    """下架：軟刪除、刪 S3 檔、清收藏與排序。"""
    public_route_service.unpublish_route(db, storage, slug)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
