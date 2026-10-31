"""公開路線：所有人可讀的清單與 GPX 下載，以及匯入腳本用的 upsert／下架。router 只負責 HTTP。

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

from app.core.db import utcnow
from app.core.errors import ApiError
from app.core.types import geometry_from_wkt
from app.core.ulid import new_ulid
from app.models import Favorite, Route, User
from app.services.gpx import infer_route_type, parse_gpx
from app.services.storage import GpxStorage, gpx_key

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


def unpublish_missing(db: Session, storage: GpxStorage, keep_slugs: set[str]) -> list[str]:
    """下架不在 keep_slugs 裡的公開路線（軟刪除、刪 S3 檔、清收藏），回傳被下架的 slug。"""
    removed: list[str] = []
    for route in db.scalars(_active_public()):
        if route.slug in keep_slugs:
            continue
        route.deleted_at = utcnow()
        db.execute(delete(Favorite).where(Favorite.route_id == route.id))
        storage.delete(route.s3_key)
        removed.append(route.slug or route.public_id)
    db.flush()
    return removed
