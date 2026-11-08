"""使用者上傳的 GPX 路線：配額、建立上傳、完成上傳、列表、改名、刪除。router 只負責 HTTP。

流程：create_upload 發 presigned POST 到暫存區（不寫 DB）→ 瀏覽器直傳 S3 →
complete_upload 讀暫存檔解析，成功才寫到正式位置並 insert routes（status=ready）。
暫存檔由 router 在 commit 之後刪掉；刪不掉也會被 bucket lifecycle 清掉。

S3 刪除一律在 DB commit 之後（router 負責）：commit 失敗時資料庫不會指向已刪掉的檔案。
"""

import hashlib
from decimal import Decimal

from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.db import utcnow
from app.core.errors import ApiError
from app.core.types import geometry_from_wkt
from app.core.ulid import is_ulid, new_ulid
from app.models import Favorite, Route, RouteOrder, User
from app.services.gpx import InvalidGpxError, infer_route_type, parse_gpx
from app.services.storage import GpxStorage, PresignedUpload, gpx_key, upload_key

NAME_MAX = 100


def _active_routes(user: User):
    # 只算私人路線：公開路線雖掛在匯入者帳號下，但不佔配額、也不出現在「我的路線」
    return select(Route).where(
        Route.user_id == user.id, Route.visibility == "private", Route.deleted_at.is_(None)
    )


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
        upload_key(user.id, upload_id, "gpx"),
        settings.gpx_max_bytes,
        settings.s3_upload_expires_seconds,
    )
    return upload_id, presigned


def _lock_user(db: Session, user: User) -> None:
    """同一使用者的完成上傳排隊執行：兩個分頁同時完成時，配額與重複檢查不會都看到舊的數字。"""
    db.execute(select(User.id).where(User.id == user.id).with_for_update())


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
    """讀暫存檔、驗證與解析，成功後寫到正式位置並 insert routes。暫存檔由呼叫端刪除。"""
    if not is_ulid(upload_id):
        raise ApiError(404, "upload_not_found", "找不到這次上傳")
    _lock_user(db, user)
    if db.scalar(select(Route.id).where(Route.public_id == upload_id)) is not None:
        raise ApiError(409, "upload_already_completed", "這次上傳已完成")

    data = storage.read(upload_key(user.id, upload_id, "gpx"), settings.gpx_max_bytes)
    if data is None:
        raise ApiError(404, "upload_not_found", "找不到這次上傳，請重新上傳")

    _ensure_quota(db, user, settings)
    try:
        summary = parse_gpx(data)
    except InvalidGpxError as e:
        raise ApiError(422, "invalid_gpx", f"GPX 無法解析：{e}") from e

    key = gpx_key(user.id, upload_id)
    # 先寫 S3 再寫 DB：DB 失敗頂多留一個沒人指到的檔案，反過來會有指向不存在檔案的路線
    storage.put(key, data)
    now = utcnow()
    route = Route(
        public_id=upload_id,
        user_id=user.id,
        name=_route_name(name, summary.name),
        route_type=infer_route_type(summary, name),
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
    try:
        with db.begin_nested():
            db.add(route)
    except IntegrityError as e:
        # 鎖之外的極端情況（例如不支援 FOR UPDATE 的資料庫）仍回 409，不是 500
        raise ApiError(409, "upload_already_completed", "這次上傳已完成") from e
    return route


def list_routes(db: Session, user: User) -> list[Route]:
    return list(db.scalars(_active_routes(user).order_by(Route.created_at.desc())))


def get_route(db: Session, user: User, public_id: str) -> Route:
    """只找得到自己的路線；別人的與已刪除的一律 404。"""
    route = db.scalar(_active_routes(user).where(Route.public_id == public_id))
    if route is None:
        raise ApiError(404, "route_not_found", "找不到這條路線")
    return route


def rename_route(db: Session, user: User, public_id: str, name: str) -> Route:
    """改名；去掉前後空白、截到 NAME_MAX，全空白視為無效。"""
    route = get_route(db, user, public_id)
    cleaned = name.strip()[:NAME_MAX]
    if not cleaned:
        raise ApiError(422, "invalid_name", "路線名稱不能是空白")
    route.name = cleaned
    db.flush()
    return route


def delete_route(db: Session, user: User, public_id: str) -> str:
    """軟刪除 routes（配額立即釋出），收藏與自訂排序一併清掉；回傳要在 commit 後刪掉的 S3 key。"""
    route = get_route(db, user, public_id)
    route.deleted_at = utcnow()
    db.execute(delete(Favorite).where(Favorite.route_id == route.id))
    db.execute(delete(RouteOrder).where(RouteOrder.route_id == route.id))
    db.flush()
    return route.s3_key
