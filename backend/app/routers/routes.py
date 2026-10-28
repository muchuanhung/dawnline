from typing import Annotated

from fastapi import APIRouter, Depends, Response, status

from app.deps import AppSettings, CurrentUser, DbSession
from app.models import Route
from app.schemas.route import (
    DownloadOut,
    RouteCreate,
    RouteList,
    RouteOut,
    RouteUpdate,
    UploadCreate,
    UploadOut,
)
from app.services import route_service
from app.services.storage import GpxStorage, get_storage

router = APIRouter(prefix="/api/v1/routes", tags=["routes"])

Storage = Annotated[GpxStorage, Depends(get_storage)]


def _route_out(route: Route) -> RouteOut:
    return RouteOut(
        id=route.public_id,
        name=route.name,
        type=route.route_type,
        status=route.status,
        distance_km=float(route.distance_km) if route.distance_km is not None else None,
        elevation_gain_m=route.elevation_gain_m,
        file_size=route.file_size,
        created_at=route.created_at,
    )


@router.post("/uploads", response_model=UploadOut, status_code=status.HTTP_201_CREATED)
def create_upload(
    body: UploadCreate, user: CurrentUser, db: DbSession, settings: AppSettings, storage: Storage
):
    """第 1 步：檢查配額與大小，發 presigned POST。"""
    upload_id, presigned = route_service.create_upload(db, user, storage, settings, body.file_size)
    return UploadOut(
        upload_id=upload_id,
        url=presigned.url,
        fields=presigned.fields,
        max_bytes=settings.gpx_max_bytes,
    )


@router.post("", response_model=RouteOut, status_code=status.HTTP_201_CREATED)
def complete_upload(
    body: RouteCreate, user: CurrentUser, db: DbSession, settings: AppSettings, storage: Storage
):
    """第 2 步：檔案已傳到 S3，解析並建立路線。"""
    route = route_service.complete_upload(db, user, storage, settings, body.upload_id, body.name)
    db.commit()
    return _route_out(route)


@router.get("", response_model=RouteList)
def list_routes(user: CurrentUser, db: DbSession, settings: AppSettings):
    routes = route_service.list_routes(db, user)
    return RouteList(routes=[_route_out(r) for r in routes], limit=settings.gpx_max_routes_per_user)


@router.get("/{route_id}/gpx", response_model=DownloadOut)
def download_gpx(
    route_id: str, user: CurrentUser, db: DbSession, settings: AppSettings, storage: Storage
):
    """回短效 presigned GET URL；前端可 fetch 內容或直接下載。"""
    route = route_service.get_route(db, user, route_id)
    url = storage.presign_download(
        route.s3_key, f"{route.name}.gpx", settings.s3_download_expires_seconds
    )
    return DownloadOut(url=url)


@router.patch("/{route_id}", response_model=RouteOut)
def rename_route(route_id: str, body: RouteUpdate, user: CurrentUser, db: DbSession):
    """改名：只改 DB 的 name，S3 檔案與 id 不變（下載檔名跟著新名稱）。"""
    route = route_service.rename_route(db, user, route_id, body.name)
    db.commit()
    return _route_out(route)


@router.delete("/{route_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_route(route_id: str, user: CurrentUser, db: DbSession, storage: Storage) -> Response:
    route_service.delete_route(db, user, storage, route_id)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
