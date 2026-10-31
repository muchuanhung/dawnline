"""公開路線：不需登入。前端（Next.js 伺服器端）讀清單與 GPX，解析與判讀仍在前端。"""

from typing import Annotated

from fastapi import APIRouter, Depends

from app.deps import AppSettings, DbSession
from app.models import Route
from app.schemas.route import DownloadOut, PublicRouteList, PublicRouteOut
from app.services import public_route_service
from app.services.storage import GpxStorage, get_storage

router = APIRouter(prefix="/api/v1/public-routes", tags=["public-routes"])

Storage = Annotated[GpxStorage, Depends(get_storage)]


def _public_out(route: Route) -> PublicRouteOut:
    return PublicRouteOut(
        id=route.slug or route.public_id,
        name=route.name,
        type=route.route_type,
        distance_km=float(route.distance_km) if route.distance_km is not None else None,
        elevation_gain_m=route.elevation_gain_m,
        updated_at=route.updated_at,
    )


@router.get("", response_model=PublicRouteList)
def list_public_routes(db: DbSession):
    return PublicRouteList(
        routes=[_public_out(r) for r in public_route_service.list_public_routes(db)]
    )


@router.get("/{slug}/gpx", response_model=DownloadOut)
def download_public_gpx(slug: str, db: DbSession, settings: AppSettings, storage: Storage):
    """回短效 presigned GET URL（與私人路線下載相同）。"""
    route = public_route_service.get_public_route(db, slug)
    url = storage.presign_download(
        route.s3_key, f"{route.name}.gpx", settings.s3_download_expires_seconds
    )
    return DownloadOut(url=url)
