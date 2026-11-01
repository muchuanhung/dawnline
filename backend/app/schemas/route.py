from pydantic import Field

from app.schemas.base import CamelModel, UtcDatetime


class UploadCreate(CamelModel):
    file_size: int = Field(gt=0)


class UploadOut(CamelModel):
    """瀏覽器拿 url + fields 以 multipart/form-data POST 到 S3，file 欄位放最後。"""

    upload_id: str
    url: str
    fields: dict[str, str]
    max_bytes: int


class RouteCreate(CamelModel):
    upload_id: str = Field(min_length=26, max_length=26)
    name: str | None = Field(default=None, max_length=200)


class RouteUpdate(CamelModel):
    """改名；空白與超過長度由 service 處理（與上傳時的命名規則一致）。"""

    name: str = Field(min_length=1, max_length=200)


class RouteOut(CamelModel):
    """id 是 public_id（ULID）；不回傳內部流水號與 s3_key。"""

    id: str
    name: str
    type: str
    status: str
    distance_km: float | None
    elevation_gain_m: int | None
    file_size: int
    created_at: UtcDatetime


class RouteList(CamelModel):
    routes: list[RouteOut]
    limit: int


class DownloadOut(CamelModel):
    url: str


class PublicRouteOut(CamelModel):
    """公開路線；id 是 slug（沿用原 GPX 檔名），不需登入。"""

    id: str
    name: str
    type: str
    distance_km: float | None
    elevation_gain_m: int | None
    updated_at: UtcDatetime


class PublicRouteList(CamelModel):
    routes: list[PublicRouteOut]


class AdminPublicRouteCreate(CamelModel):
    """Admin upload, step 2: the file is in S3; slug rules = public_route_service.SLUG_PATTERN."""

    upload_id: str = Field(min_length=26, max_length=26)
    slug: str = Field(min_length=1, max_length=64)


class AdminPublicRouteResult(CamelModel):
    """action: created / updated / unchanged (same as the import script output)."""

    action: str
    route: PublicRouteOut


class FavoriteOut(CamelModel):
    """id 與其他 API 一致：公開路線 slug、私人路線 public_id。"""

    id: str
    visibility: str
    name: str
    created_at: UtcDatetime


class FavoriteList(CamelModel):
    favorites: list[FavoriteOut]
    limit: int


class RouteOrderIn(CamelModel):
    """「我的路線」新順序；id 規則同收藏。上限見 route_order_service.ORDER_MAX。"""

    ids: list[str] = Field(max_length=100)


class RouteOrderOut(CamelModel):
    ids: list[str]
