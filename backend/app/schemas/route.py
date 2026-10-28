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
