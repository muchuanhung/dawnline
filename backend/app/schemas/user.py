from pydantic import Field, computed_field

from app.schemas.base import CamelModel, UtcDatetime

AVATAR_PATH = "/api/v1/me/avatar"


class UserOut(CamelModel):
    """不回傳內部流水號 id 與 S3 key。"""

    email: str | None
    display_name: str | None
    created_at: UtcDatetime
    last_login_at: UtcDatetime
    # Read from the ORM row only to build avatar_url; never serialized
    avatar_key: str | None = Field(default=None, exclude=True)
    # Filled by the router from settings (ADMIN_FIREBASE_UIDS); only shows/hides admin buttons
    is_admin: bool = False

    @computed_field
    @property
    def avatar_url(self) -> str | None:
        """自己上傳的頭像（同站網址，經 rewrite 帶 cookie）。

        ?v= 用 key 裡的 ULID：換圖後網址跟著變，不會讀到快取的舊圖。
        """
        if not self.avatar_key:
            return None
        version = self.avatar_key.rsplit("/", 1)[-1].removesuffix(".jpg")
        return f"{AVATAR_PATH}?v={version}"


def user_out(user: object, is_admin: bool) -> UserOut:
    """ORM User -> UserOut with is_admin (decided by the router from settings)."""
    out = UserOut.model_validate(user)
    out.is_admin = is_admin
    return out


class AvatarUploadCreate(CamelModel):
    file_size: int = Field(gt=0)


class AvatarUploadOut(CamelModel):
    """瀏覽器拿 url + fields 以 multipart/form-data POST 到 S3，file 欄位放最後。"""

    upload_id: str
    url: str
    fields: dict[str, str]
    max_bytes: int


class AvatarConfirm(CamelModel):
    upload_id: str = Field(min_length=26, max_length=26)
