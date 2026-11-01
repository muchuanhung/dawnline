from fastapi import APIRouter

from app.deps import CurrentUser, DbSession
from app.schemas.route import RouteOrderIn, RouteOrderOut
from app.schemas.user import UserOut
from app.services import route_order_service

router = APIRouter(prefix="/api/v1", tags=["me"])


@router.get("/me", response_model=UserOut)
def get_me(user: CurrentUser):
    return user


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
