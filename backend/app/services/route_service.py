"""使用者上傳的 GPX 路線：配額、建立上傳、完成上傳、列表、刪除。router 只負責 HTTP。

流程：create_upload 發 presigned POST（不寫 DB）→ 瀏覽器直傳 S3 →
complete_upload 從 S3 讀檔解析，成功才 insert routes（status=ready），失敗刪檔。
"""

import hashlib
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.db import utcnow
from app.core.errors import ApiError
from app.core.types import geometry_from_wkt
from app.core.ulid import is_ulid, new_ulid
from app.models import Route, User
from app.services.gpx import InvalidGpxError, parse_gpx
from app.services.storage import GpxStorage, PresignedUpload, gpx_key

NAME_MAX = 100


def _active_routes(user: User):
    return select(Route).where(Route.user_id == user.id, Route.deleted_at.is_(None))


def count_routes(db: Session, user: User) -> int:
    return db.scalar(select(func.count()).select_from(_active_routes(user).subquery())) or 0


def _ensure_quota(db: Session, user: User, settings: Settings) -> None:
    if count_routes(db, user) >= settings.gpx_max_routes_per_user:
        raise ApiError(
            409,
            "route_limit_reached",
            f"每位使用者最多 {settings.gpx_max_routes_per_user} 條路線，請先刪除舊路線",
        )


def create_upload(
    db: Session, user: User, storage: GpxStorage, settings: Settings, file_size: int
) -> tuple[str, PresignedUpload]:
    """檢查配額與大小後發 presigned POST；回傳 (upload_id, presigned)。"""
    if file_size > settings.gpx_max_bytes:
        raise ApiError(413, "file_too_large", "GPX 檔案超過大小上限")
    _ensure_quota(db, user, settings)
    upload_id = new_ulid()
    presigned = storage.presign_upload(
        gpx_key(user.id, upload_id), settings.gpx_max_bytes, settings.s3_upload_expires_seconds
    )
    return upload_id, presigned


def _route_name(requested: str | None, gpx_name: str | None) -> str:
    # 優先用前端送的名稱（通常是檔名），其次 GPX 內的 <name>
    for candidate in (requested, gpx_name):
        if candidate and candidate.strip():
            return candidate.strip()[:NAME_MAX]
    return "未命名路線"


def complete_upload(
    db: Session,
    user: User,
    storage: GpxStorage,
    settings: Settings,
    upload_id: str,
    name: str | None,
) -> Route:
    """讀 S3 上的檔案、驗證與解析，成功後寫入 routes。"""
    if not is_ulid(upload_id):
        raise ApiError(404, "upload_not_found", "找不到這次上傳")
    if db.scalar(select(Route.id).where(Route.public_id == upload_id)) is not None:
        raise ApiError(409, "upload_already_completed", "這次上傳已完成")

    key = gpx_key(user.id, upload_id)
    data = storage.read(key, settings.gpx_max_bytes)
    if data is None:
        raise ApiError(404, "upload_not_found", "找不到這次上傳，請重新上傳")

    try:
        _ensure_quota(db, user, settings)
        summary = parse_gpx(data)
    except InvalidGpxError as e:
        storage.delete(key)
        raise ApiError(422, "invalid_gpx", f"GPX 無法解析：{e}") from e
    except ApiError:
        storage.delete(key)
        raise

    now = utcnow()
    route = Route(
        public_id=upload_id,
        user_id=user.id,
        name=_route_name(name, summary.name),
        s3_key=key,
        file_size=len(data),
        file_sha256=hashlib.sha256(data).hexdigest(),
        status="ready",
        distance_km=Decimal(str(summary.distance_km)),
        elevation_gain_m=summary.elevation_gain_m,
        bbox=geometry_from_wkt(db, summary.bbox_wkt()),
        created_at=now,
        updated_at=now,
    )
    db.add(route)
    db.flush()
    return route


def list_routes(db: Session, user: User) -> list[Route]:
    return list(db.scalars(_active_routes(user).order_by(Route.created_at.desc())))


def get_route(db: Session, user: User, public_id: str) -> Route:
    """只找得到自己的路線；別人的與已刪除的一律 404。"""
    route = db.scalar(_active_routes(user).where(Route.public_id == public_id))
    if route is None:
        raise ApiError(404, "route_not_found", "找不到這條路線")
    return route


def delete_route(db: Session, user: User, storage: GpxStorage, public_id: str) -> None:
    """軟刪除 routes 並刪掉 S3 檔案（檔案不保留，配額立即釋出）。"""
    route = get_route(db, user, public_id)
    route.deleted_at = utcnow()
    db.flush()
    storage.delete(route.s3_key)
