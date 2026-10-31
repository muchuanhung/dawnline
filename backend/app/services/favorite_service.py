"""收藏：公開路線，或使用者自己的私人路線。router 只負責 HTTP。

收藏 API 的路線 id 與其他 API 相同：公開路線用 slug，私人路線用 public_id（ULID）。
看不到的路線（別人的私人路線、已刪除、不存在）一律 404，不透露是否存在。
"""

from sqlalchemy import and_, delete, func, or_, select
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.errors import ApiError
from app.core.ulid import is_ulid
from app.models import Favorite, Route, User


def route_external_id(route: Route) -> str:
    """對外 id：公開路線 slug，私人路線 public_id。"""
    return route.slug if route.visibility == "public" and route.slug else route.public_id


def _visible_to(user: User):
    """使用者看得到的路線：未刪除，且是公開路線或自己的私人路線。"""
    return and_(
        Route.deleted_at.is_(None),
        Route.status == "ready",
        or_(
            Route.visibility == "public",
            and_(Route.visibility == "private", Route.user_id == user.id),
        ),
    )


def _find_route(db: Session, user: User, route_id: str) -> Route:
    # id 可能是私人路線的 public_id 或公開路線的 slug；只在看得到的範圍內找
    cond = Route.slug == route_id
    if is_ulid(route_id):
        cond = or_(cond, Route.public_id == route_id)
    route = db.scalar(select(Route).where(cond, _visible_to(user)))
    if route is None:
        raise ApiError(404, "route_not_found", "找不到這條路線")
    return route


def list_favorites(db: Session, user: User) -> list[Favorite]:
    """新收藏在前；路線已看不到的（被下架、刪除）不列出。"""
    stmt = (
        select(Favorite)
        .join(Route, Favorite.route_id == Route.id)
        .where(Favorite.user_id == user.id, _visible_to(user))
        .order_by(Favorite.created_at.desc())
    )
    return list(db.scalars(stmt).unique())


def add_favorite(db: Session, user: User, settings: Settings, route_id: str) -> None:
    """冪等：已收藏就不動；超過上限回 409。"""
    route = _find_route(db, user, route_id)
    if db.get(Favorite, (user.id, route.id)) is not None:
        return
    count = db.scalar(select(func.count()).where(Favorite.user_id == user.id)) or 0
    if count >= settings.favorites_max_per_user:
        raise ApiError(
            409,
            "favorite_limit_reached",
            f"每位使用者最多收藏 {settings.favorites_max_per_user} 條路線",
        )
    db.add(Favorite(user_id=user.id, route_id=route.id))
    db.flush()


def remove_favorite(db: Session, user: User, route_id: str) -> None:
    """冪等：沒收藏也回成功；路線看不到仍回 404（與加入一致）。"""
    route = _find_route(db, user, route_id)
    db.execute(delete(Favorite).where(Favorite.user_id == user.id, Favorite.route_id == route.id))
    db.flush()
