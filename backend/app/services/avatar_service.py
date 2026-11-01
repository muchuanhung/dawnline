"""使用者自訂頭像：發 presigned POST、確認上傳、刪除、產生檢視用 URL。router 只負責 HTTP。

流程與 GPX 上傳相同：create_upload 發 presigned POST（不寫 DB）→ 瀏覽器直傳 S3 →
confirm_upload 讀回檔案檢查是 JPEG，才把 users.avatar_key 指過去並刪掉舊檔；不合格就刪檔。
"""

from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.errors import ApiError
from app.core.ulid import is_ulid, new_ulid
from app.models import User
from app.services.storage import AVATAR_CONTENT_TYPE, GpxStorage, PresignedUpload, avatar_key

# JPEG 檔頭（SOI + 下一個 marker 的 0xFF）；Content-Type 由 policy 鎖定，這裡再確認內容真的是 JPEG
_JPEG_MAGIC = b"\xff\xd8\xff"


def create_upload(
    user: User, storage: GpxStorage, settings: Settings, file_size: int
) -> tuple[str, PresignedUpload]:
    if file_size > settings.avatar_max_bytes:
        raise ApiError(413, "file_too_large", "頭像超過大小上限")
    upload_id = new_ulid()
    presigned = storage.presign_upload(
        avatar_key(user.id, upload_id),
        settings.avatar_max_bytes,
        settings.s3_upload_expires_seconds,
        content_type=AVATAR_CONTENT_TYPE,
    )
    return upload_id, presigned


def confirm_upload(
    db: Session, user: User, storage: GpxStorage, settings: Settings, upload_id: str
) -> User:
    if not is_ulid(upload_id):
        raise ApiError(404, "upload_not_found", "找不到這次上傳")
    key = avatar_key(user.id, upload_id)
    if user.avatar_key == key:
        return user  # 重送同一次確認：冪等

    data = storage.read(key, settings.avatar_max_bytes, label="頭像")
    if data is None:
        raise ApiError(404, "upload_not_found", "找不到這次上傳，請重新上傳")
    if not data.startswith(_JPEG_MAGIC):
        storage.delete(key)
        raise ApiError(422, "invalid_image", "頭像必須是 JPEG 圖片")

    old_key = user.avatar_key
    user.avatar_key = key
    db.flush()
    if old_key:
        storage.delete(old_key)
    return user


def delete_avatar(db: Session, user: User, storage: GpxStorage) -> None:
    """刪除自訂頭像（之後顯示 Google 頭像或姓名縮寫）；沒有頭像也回成功。"""
    if not user.avatar_key:
        return
    storage.delete(user.avatar_key)
    user.avatar_key = None
    db.flush()


def view_url(user: User, storage: GpxStorage, expires: int) -> str:
    if not user.avatar_key:
        raise ApiError(404, "avatar_not_found", "尚未上傳頭像")
    return storage.presign_view(user.avatar_key, AVATAR_CONTENT_TYPE, expires)
