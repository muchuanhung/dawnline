"""自訂頭像 API：用 moto 假 S3，瀏覽器直傳 S3 的步驟以 put_object 代替。"""

import base64
import json
from urllib.parse import parse_qs, urlparse

import pytest

from app.core.config import Settings, get_settings
from app.services.storage import GpxStorage, get_storage
from tests.conftest import login
from tests.test_routes import BUCKET, s3  # noqa: F401  (s3 fixture)

# Smallest byte string that starts like a JPEG; content past the header is not inspected
JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 60


@pytest.fixture
def api(client, s3):  # noqa: F811
    """已登入的 client；頭像上限換成 1 KB。"""
    test_settings = Settings(
        database_url="sqlite://",
        session_cookie_secure=False,
        s3_bucket=BUCKET,
        avatar_max_bytes=1024,
    )
    client.app.dependency_overrides[get_settings] = lambda: test_settings
    client.app.dependency_overrides[get_storage] = lambda: GpxStorage(s3, BUCKET)
    login(client)
    return client


def upload(api, s3, data: bytes = JPEG):  # noqa: F811
    """拿 presigned POST → 模擬瀏覽器傳檔 → 確認；回傳 (確認的 response, 正式位置的 S3 key)。"""
    res = api.post("/api/v1/me/avatar/uploads", json={"fileSize": len(data)})
    assert res.status_code == 201, res.text
    body = res.json()
    s3.put_object(Bucket=BUCKET, Key=body["fields"]["key"], Body=data, ContentType="image/jpeg")
    confirmed = api.put("/api/v1/me/avatar", json={"uploadId": body["uploadId"]})
    return confirmed, f"users/1/avatar/{body['uploadId']}.jpg"


def keys(s3) -> list[str]:  # noqa: F811
    return [o["Key"] for o in s3.list_objects_v2(Bucket=BUCKET).get("Contents", [])]


def test_presigned_post_is_jpeg_only_and_size_limited(api):
    res = api.post("/api/v1/me/avatar/uploads", json={"fileSize": 500})
    assert res.status_code == 201
    body = res.json()
    # 先傳到暫存區（lifecycle 1 天清掉），確認後才寫到 users/1/avatar/
    assert body["fields"]["key"] == f"tmp-uploads/1/{body['uploadId']}.jpg"
    policy = json.loads(base64.b64decode(body["fields"]["policy"]))
    assert {"Content-Type": "image/jpeg"} in policy["conditions"]
    assert ["content-length-range", 1, 1024] in policy["conditions"]


def test_too_large_is_413(api):
    res = api.post("/api/v1/me/avatar/uploads", json={"fileSize": 2048})
    assert res.status_code == 413


def test_upload_sets_avatar_url(api, s3):  # noqa: F811
    res, key = upload(api, s3)
    assert res.status_code == 200, res.text
    version = key.rsplit("/", 1)[-1].removesuffix(".jpg")
    assert res.json()["avatarUrl"] == f"/api/v1/me/avatar?v={version}"
    assert "avatarKey" not in res.json()
    assert api.get("/api/v1/me").json()["avatarUrl"] == res.json()["avatarUrl"]


def test_session_response_includes_avatar_url(api, s3):  # noqa: F811
    res, _ = upload(api, s3)
    again = api.post("/api/v1/auth/session", json={"idToken": "valid:uid-1"})
    assert again.json()["avatarUrl"] == res.json()["avatarUrl"]


def test_no_avatar_by_default(api):
    assert api.get("/api/v1/me").json()["avatarUrl"] is None
    assert api.get("/api/v1/me/avatar", follow_redirects=False).status_code == 404


def test_view_redirects_to_presigned_url(api, s3):  # noqa: F811
    _, key = upload(api, s3)
    res = api.get("/api/v1/me/avatar", follow_redirects=False)
    assert res.status_code == 302
    assert res.headers["cache-control"].startswith("private")
    location = urlparse(res.headers["location"])
    assert location.path.endswith(key)
    assert parse_qs(location.query)["response-content-type"] == ["image/jpeg"]


def test_replacing_deletes_old_file(api, s3):  # noqa: F811
    _, first = upload(api, s3)
    res, second = upload(api, s3)
    assert res.status_code == 200
    assert keys(s3) == [second]
    assert first != second


def test_non_jpeg_is_rejected_and_deleted(api, s3):  # noqa: F811
    res, _ = upload(api, s3, b"<svg xmlns='http://www.w3.org/2000/svg'/>")
    assert res.status_code == 422
    assert res.json()["error"]["code"] == "invalid_image"
    assert keys(s3) == []
    assert api.get("/api/v1/me").json()["avatarUrl"] is None


def test_confirm_without_file_is_404(api):
    res = api.put("/api/v1/me/avatar", json={"uploadId": "01JBXXXXXXXXXXXXXXXXXXXXXX"})
    assert res.status_code == 404


def test_confirm_twice_is_idempotent(api, s3):  # noqa: F811
    res = api.post("/api/v1/me/avatar/uploads", json={"fileSize": len(JPEG)})
    body = res.json()
    s3.put_object(Bucket=BUCKET, Key=body["fields"]["key"], Body=JPEG)
    first = api.put("/api/v1/me/avatar", json={"uploadId": body["uploadId"]})
    second = api.put("/api/v1/me/avatar", json={"uploadId": body["uploadId"]})
    assert first.status_code == second.status_code == 200
    assert keys(s3) == [f"users/1/avatar/{body['uploadId']}.jpg"]


def test_confirm_moves_file_out_of_staging(api, s3):  # noqa: F811
    res, key = upload(api, s3)
    assert res.status_code == 200
    assert keys(s3) == [key]
    obj = s3.head_object(Bucket=BUCKET, Key=key)
    assert obj["ContentType"] == "image/jpeg"


def test_delete_removes_file_and_url(api, s3):  # noqa: F811
    upload(api, s3)
    assert api.delete("/api/v1/me/avatar").status_code == 204
    assert keys(s3) == []
    assert api.get("/api/v1/me").json()["avatarUrl"] is None
    # 沒有頭像時再刪一次也成功
    assert api.delete("/api/v1/me/avatar").status_code == 204


def test_cannot_confirm_other_users_upload(api, s3):  # noqa: F811
    res = api.post("/api/v1/me/avatar/uploads", json={"fileSize": len(JPEG)})
    body = res.json()
    s3.put_object(Bucket=BUCKET, Key=body["fields"]["key"], Body=JPEG)
    # 換成另一位使用者，用同一個 upload id 確認：key 由登入者推得，對不到檔案
    login(api, "valid:uid-2")
    assert api.put("/api/v1/me/avatar", json={"uploadId": body["uploadId"]}).status_code == 404


def test_requires_login(client):
    assert client.post("/api/v1/me/avatar/uploads", json={"fileSize": 10}).status_code == 401
    assert client.get("/api/v1/me/avatar").status_code == 401
