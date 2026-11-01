"""「我的路線」自訂順序：整份讀出、整份取代。router 只負責 HTTP。

路線 id 與收藏 API 相同：公開路線 slug、私人路線 public_id（ULID）。
只記得使用者看得到的路線；已下架、刪除或別人的私人路線在讀寫時都略過，不報錯
（前端拿到的清單可能比後端舊一點，排序不該因此失敗）。
"""

from sqlalchemy import delete, or_, select
from sqlalchemy.orm import Session

from app.core.ulid import is_ulid
from app.models import Route, RouteOrder, User
from app.services.favorite_service import route_external_id, visible_to

# 收藏上限 50＋私人路線上限 10，留一點餘裕
ORDER_MAX = 100


def get_order(db: Session, user: User) -> list[str]:
    """依 position 排序的路線 id；看不到的路線不列出。"""
    stmt = (
        select(Route)
        .join(RouteOrder, RouteOrder.route_id == Route.id)
        .where(RouteOrder.user_id == user.id, visible_to(user))
        .order_by(RouteOrder.position)
    )
    return [route_external_id(r) for r in db.scalars(stmt)]


def set_order(db: Session, user: User, ids: list[str]) -> list[str]:
    """整份取代：重複的 id 只算第一次，找不到或看不到的略過；回傳實際存下的順序。"""
    wanted = list(dict.fromkeys(ids))[:ORDER_MAX]
    slugs = [i for i in wanted if not is_ulid(i)]
    ulids = [i for i in wanted if is_ulid(i)]
    found = db.scalars(
        select(Route).where(
            or_(Route.slug.in_(slugs), Route.public_id.in_(ulids)), visible_to(user)
        )
    )
    by_id = {route_external_id(r): r for r in found}
    kept = [by_id[i] for i in wanted if i in by_id]

    db.execute(delete(RouteOrder).where(RouteOrder.user_id == user.id))
    db.add_all(
        RouteOrder(user_id=user.id, route_id=r.id, position=pos) for pos, r in enumerate(kept)
    )
    db.flush()
    return [route_external_id(r) for r in kept]
