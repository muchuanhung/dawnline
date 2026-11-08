"""使用者自訂頭像：發 presigned POST、確認上傳、刪除、產生檢視用 URL。router 只負責 HTTP。

流程與 GPX 上傳相同：create_upload 發 presigned POST 到暫存區（不寫 DB）→ 瀏覽器直傳 S3 →
confirm_upload 讀回暫存檔檢查是 JPEG，寫到正式位置後才把 users.avatar_key 指過去。
暫存檔與舊頭像都由 router 在 commit 之後刪掉（commit 失敗時 DB 不會指向已刪掉的檔案）。
"""

from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.errors import ApiError
from app.core.ulid import is_ulid, new_ulid
from app.models import User
from app.services.storage import (
    AVATAR_CONTENT_TYPE,
    GpxStorage,
    PresignedUpload,
    avatar_key,
    upload_key,
)

# JPEG 檔頭（SOI + 下一個 marker 的 0xFF）；Content-Type 由 policy 鎖定，這裡再確認內容真的是 JPEG
_JPEG_MAGIC = b"\xff\xd8\xff"


def create_upload(
    user: User, storage: GpxStorage, settings: Settings, file_size: int
) -> tuple[str, PresignedUpload]:
    if file_size > settings.avatar_max_bytes:
        raise ApiError(413, "file_too_large", "頭像超過大小上限")
    upload_id = new_ulid()
    presigned = storage.presign_upload(
        upload_key(user.id, upload_id, "jpg"),
        settings.avatar_max_bytes,
        settings.s3_upload_expires_seconds,
        content_type=AVATAR_CONTENT_TYPE,
    )
    return upload_id, presigned


def confirm_upload(
    db: Session, user: User, storage: GpxStorage, settings: Settings, upload_id: str
) -> str | None:
    """換成新頭像；回傳要在 commit 後刪掉的舊頭像 key（沒有就 None）。"""
    if not is_ulid(upload_id):
        raise ApiError(404, "upload_not_found", "找不到這次上傳")
    key = avatar_key(user.id, upload_id)
    if user.avatar_key == key:
        return None  # 重送同一次確認：冪等

    data = storage.read(
        upload_key(user.id, upload_id, "jpg"), settings.avatar_max_bytes, label="頭像"
    )
    if data is None:
        raise ApiError(404, "upload_not_found", "找不到這次上傳，請重新上傳")
    if not data.startswith(_JPEG_MAGIC):
        raise ApiError(422, "invalid_image", "頭像必須是 JPEG 圖片")

    storage.put(key, data, content_type=AVATAR_CONTENT_TYPE)
    old_key = user.avatar_key
    user.avatar_key = key
    db.flush()
    return old_key


def delete_avatar(db: Session, user: User) -> str | None:
    """刪除自訂頭像（之後顯示 Google 頭像或姓名縮寫）；回傳要在 commit 後刪掉的 key。"""
    old_key = user.avatar_key
    if old_key:
        user.avatar_key = None
        db.flush()
    return old_key


def view_url(user: User, storage: GpxStorage, expires: int) -> str:
    if not user.avatar_key:
        raise ApiError(404, "avatar_not_found", "尚未上傳頭像")
    return storage.presign_view(user.avatar_key, AVATAR_CONTENT_TYPE, expires)
