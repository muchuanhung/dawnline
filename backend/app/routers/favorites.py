"""收藏：需登入。PUT／DELETE 都是冪等的，前端可以樂觀更新後直接重送。"""

from fastapi import APIRouter, Response, status

from app.deps import AppSettings, CurrentUser, DbSession
from app.schemas.route import FavoriteList, FavoriteOut
from app.services import favorite_service

router = APIRouter(prefix="/api/v1/favorites", tags=["favorites"])


@router.get("", response_model=FavoriteList)
def list_favorites(user: CurrentUser, db: DbSession, settings: AppSettings):
    favorites = favorite_service.list_favorites(db, user)
    return FavoriteList(
        favorites=[
            FavoriteOut(
                id=favorite_service.route_external_id(f.route),
                visibility=f.route.visibility,
                name=f.route.name,
                created_at=f.created_at,
            )
            for f in favorites
        ],
        limit=settings.favorites_max_per_user,
    )


@router.put("/{route_id}", status_code=status.HTTP_204_NO_CONTENT)
def add_favorite(
    route_id: str, user: CurrentUser, db: DbSession, settings: AppSettings
) -> Response:
    favorite_service.add_favorite(db, user, settings, route_id)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete("/{route_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_favorite(route_id: str, user: CurrentUser, db: DbSession) -> Response:
    favorite_service.remove_favorite(db, user, route_id)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
