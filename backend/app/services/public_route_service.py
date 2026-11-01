"""公開路線：所有人可讀的清單與 GPX 下載，以及匯入腳本與管理員上傳共用的 upsert／下架。

router 只負責 HTTP。

公開路線與私人路線同一張 routes 表（visibility='public'），差別：
- 對外 id 是 slug（沿用原 Firebase Storage 的 GPX 檔名），不是 public_id；
- 掛在匯入者帳號下但不算配額；S3 key 仍用 gpx_key(owner, public_id)，不需要新的 IAM 路徑。
"""

import hashlib
import re
from dataclasses import dataclass
from decimal import Decimal
from typing import Literal

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.db import utcnow
from app.core.errors import ApiError
from app.core.types import geometry_from_wkt
from app.core.ulid import is_ulid, new_ulid
from app.models import Favorite, Route, RouteOrder, User
from app.services.gpx import InvalidGpxError, infer_route_type, parse_gpx
from app.services.storage import GpxStorage, PresignedUpload, gpx_key

NAME_MAX = 100
# slug 沿用原 GPX 檔名（常含空白、+、括號、中文），前端一律 encodeURIComponent。
# 只擋路徑分隔、URL 保留的 ? # %、控制字元，以及頭尾空白；長度 1–64
_SLUG_CHAR = r"[^/\\?#%\x00-\x1f]"
_SLUG_EDGE = r"[^\s/\\?#%\x00-\x1f]"
SLUG_PATTERN = re.compile(rf"^(?=.{{1,64}}$){_SLUG_EDGE}(?:{_SLUG_CHAR}*{_SLUG_EDGE})?$")

ImportAction = Literal["created", "updated", "unchanged"]


@dataclass(frozen=True)
class ImportResult:
    slug: str
    action: ImportAction


def is_valid_slug(slug: str) -> bool:
    return bool(SLUG_PATTERN.match(slug))


def _active_public():
    return select(Route).where(
        Route.visibility == "public", Route.status == "ready", Route.deleted_at.is_(None)
    )


def list_public_routes(db: Session) -> list[Route]:
    return list(db.scalars(_active_public().order_by(Route.name)))


def get_public_route(db: Session, slug: str) -> Route:
    route = db.scalar(_active_public().where(Route.slug == slug)) if is_valid_slug(slug) else None
    if route is None:
        raise ApiError(404, "route_not_found", "找不到這條路線")
    return route


def import_public_route(
    db: Session, storage: GpxStorage, owner: User, slug: str, data: bytes
) -> ImportResult:
    """新增或更新一條公開路線；內容（sha256）沒變就不動。GPX 壞掉丟 InvalidGpxError。

    更新時沿用同一個 public_id 與 S3 key（覆寫檔案），收藏與 slug 都不受影響。
    """
    if not is_valid_slug(slug):
        raise ValueError(f"slug 不合法：{slug!r}")
    sha256 = hashlib.sha256(data).hexdigest()
    existing = db.scalar(select(Route).where(Route.slug == slug))
    if (
        existing is not None
        and existing.deleted_at is None
        and existing.visibility == "public"
        and existing.file_sha256 == sha256
    ):
        return ImportResult(slug, "unchanged")

    summary = parse_gpx(data)
    now = utcnow()
    route = existing
    if route is None:
        public_id = new_ulid()
        route = Route(
            public_id=public_id,
            user_id=owner.id,
            slug=slug,
            s3_key=gpx_key(owner.id, public_id),
            created_at=now,
        )
        db.add(route)
    # 先寫 S3 再寫 DB：DB 失敗頂多留一個沒人指到的檔案，反過來會有指向不存在檔案的路線
    storage.put(route.s3_key, data)
    route.name = (summary.name or slug).strip()[:NAME_MAX] or slug
    route.route_type = infer_route_type(summary, slug)
    route.visibility = "public"
    route.status = "ready"
    route.file_size = len(data)
    route.file_sha256 = sha256
    route.distance_km = Decimal(str(summary.distance_km))
    route.elevation_gain_m = summary.elevation_gain_m
    route.bbox = geometry_from_wkt(db, summary.bbox_wkt())
    route.updated_at = now
    route.deleted_at = None
    db.flush()
    return ImportResult(slug, "created" if existing is None else "updated")


def _unpublish(db: Session, storage: GpxStorage, route: Route) -> None:
    """Soft-delete one public route, drop its favourites/order rows and its S3 file."""
    route.deleted_at = utcnow()
    db.execute(delete(Favorite).where(Favorite.route_id == route.id))
    db.execute(delete(RouteOrder).where(RouteOrder.route_id == route.id))
    storage.delete(route.s3_key)


def unpublish_missing(db: Session, storage: GpxStorage, keep_slugs: set[str]) -> list[str]:
    """下架不在 keep_slugs 裡的公開路線（軟刪除、刪 S3 檔、清收藏與排序），回傳下架的 slug。"""
    removed: list[str] = []
    for route in db.scalars(_active_public()):
        if route.slug in keep_slugs:
            continue
        _unpublish(db, storage, route)
        removed.append(route.slug or route.public_id)
    db.flush()
    return removed


def unpublish_route(db: Session, storage: GpxStorage, slug: str) -> None:
    """Admin: unpublish a single public route (same effect as --prune for that slug)."""
    route = get_public_route(db, slug)
    _unpublish(db, storage, route)
    db.flush()


# --- Admin upload from the site (same import logic as the script) ---------------------------
# Step 1 hands out a presigned POST to a temporary key under the admin's own users/{id}/routes/
# prefix (no IAM change); step 2 reads it, runs import_public_route, then deletes the temp file.
# Public routes never count against the 10-route quota, so no quota check here.


def create_admin_upload(
    user: User, storage: GpxStorage, settings: Settings, file_size: int
) -> tuple[str, PresignedUpload]:
    if file_size > settings.gpx_max_bytes:
        raise ApiError(413, "file_too_large", "GPX 檔案超過大小上限")
    upload_id = new_ulid()
    presigned = storage.presign_upload(
        gpx_key(user.id, upload_id), settings.gpx_max_bytes, settings.s3_upload_expires_seconds
    )
    return upload_id, presigned


def complete_admin_upload(
    db: Session,
    user: User,
    storage: GpxStorage,
    settings: Settings,
    upload_id: str,
    slug: str,
) -> tuple[ImportResult, Route]:
    if not is_ulid(upload_id):
        raise ApiError(404, "upload_not_found", "找不到這次上傳")
    temp_key = gpx_key(user.id, upload_id)
    slug = slug.strip()
    try:
        if not is_valid_slug(slug):
            raise ApiError(422, "invalid_slug", "網址 id 最長 64 字，不能有 / \\ ? # %")
        data = storage.read(temp_key, settings.gpx_max_bytes)
        if data is None:
            raise ApiError(404, "upload_not_found", "找不到這次上傳，請重新上傳")
        result = import_public_route(db, storage, user, slug, data)
    except InvalidGpxError as e:
        raise ApiError(422, "invalid_gpx", f"GPX 無法解析：{e}") from e
    finally:
        # The import copies the bytes to the route's own key; the temp file is never needed again
        storage.delete(temp_key)
    return result, get_public_route(db, slug)
