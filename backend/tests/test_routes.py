"""GPX 上傳 API：用 moto 假 S3，不連 AWS。瀏覽器直傳 S3 的步驟以 put_object 代替。"""

import base64
import json
from collections.abc import Iterator

import pytest
from moto import mock_aws

from app.core.config import Settings, get_settings
from app.services.storage import GpxStorage, build_s3_client, get_storage
from tests.conftest import login

BUCKET = "test-gpx"

GPX = b"""<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1">
  <trk><name>\xe9\x99\xbd\xe9\x87\x91\xe5\x85\xac\xe8\xb7\xaf</name><trkseg>
    <trkpt lat="25.1650" lon="121.5600"><ele>400</ele></trkpt>
    <trkpt lat="25.1700" lon="121.5650"><ele>450</ele></trkpt>
    <trkpt lat="25.1750" lon="121.5700"><ele>430</ele></trkpt>
    <trkpt lat="25.1800" lon="121.5750"><ele>500</ele></trkpt>
  </trkseg></trk>
</gpx>"""


@pytest.fixture
def s3() -> Iterator:
    with mock_aws():
        # 與正式環境同一個 client 設定（regional endpoint、SigV4）
        client = build_s3_client("ap-northeast-1")
        client.create_bucket(
            Bucket=BUCKET, CreateBucketConfiguration={"LocationConstraint": "ap-northeast-1"}
        )
        yield client


@pytest.fixture
def api(client, s3, settings):
    """已登入的 client，S3 與上限換成測試值（每人 2 條、每檔 2 KB）。"""
    test_settings = Settings(
        database_url="sqlite://",
        session_cookie_secure=False,
        s3_bucket=BUCKET,
        gpx_max_bytes=2048,
        gpx_max_routes_per_user=2,
    )
    client.app.dependency_overrides[get_settings] = lambda: test_settings
    client.app.dependency_overrides[get_storage] = lambda: GpxStorage(s3, BUCKET)
    login(client)
    return client


def upload(api, s3, data: bytes = GPX, name: str | None = "陽金公路.gpx"):
    """完整走一次：拿 presigned POST → 模擬瀏覽器傳檔 → 完成。"""
    res = api.post("/api/v1/routes/uploads", json={"fileSize": len(data)})
    assert res.status_code == 201, res.text
    body = res.json()
    s3.put_object(Bucket=BUCKET, Key=body["fields"]["key"], Body=data)
    return api.post("/api/v1/routes", json={"uploadId": body["uploadId"], "name": name})


def test_presigned_post_is_scoped_to_user_and_size(api):
    res = api.post("/api/v1/routes/uploads", json={"fileSize": 100})
    assert res.status_code == 201
    body = res.json()
    assert body["fields"]["key"] == f"users/1/routes/{body['uploadId']}.gpx"
    policy = json.loads(base64.b64decode(body["fields"]["policy"]))
    assert ["content-length-range", 1, 2048] in policy["conditions"]
    assert body["maxBytes"] == 2048


def test_upload_and_list(api, s3):
    res = upload(api, s3)
    assert res.status_code == 201, res.text
    route = res.json()
    assert route["name"] == "陽金公路.gpx"
    assert route["status"] == "ready"
    assert route["elevationGainM"] == 120
    assert 2.0 < route["distanceKm"] < 2.4
    assert route["fileSize"] == len(GPX)

    listed = api.get("/api/v1/routes").json()
    assert listed["limit"] == 2
    assert [r["id"] for r in listed["routes"]] == [route["id"]]


def test_name_falls_back_to_gpx_name(api, s3):
    assert upload(api, s3, name=None).json()["name"] == "陽金公路"


def test_invalid_gpx_is_rejected_and_deleted(api, s3):
    res = api.post("/api/v1/routes/uploads", json={"fileSize": 10})
    body = res.json()
    s3.put_object(Bucket=BUCKET, Key=body["fields"]["key"], Body=b"<gpx></gpx>")
    res = api.post("/api/v1/routes", json={"uploadId": body["uploadId"]})
    assert res.status_code == 422
    assert res.json()["error"]["code"] == "invalid_gpx"
    assert s3.list_objects_v2(Bucket=BUCKET).get("KeyCount") == 0


def test_xml_entity_attack_is_rejected(api, s3):
    evil = b"""<?xml version="1.0"?><!DOCTYPE gpx [<!ENTITY x SYSTEM "file:///etc/passwd">]>
<gpx><trk><name>&x;</name></trk></gpx>"""
    assert upload(api, s3, data=evil).json()["error"]["code"] == "invalid_gpx"


def test_complete_without_file_is_404(api):
    upload_id = api.post("/api/v1/routes/uploads", json={"fileSize": 10}).json()["uploadId"]
    res = api.post("/api/v1/routes", json={"uploadId": upload_id})
    assert res.status_code == 404
    assert res.json()["error"]["code"] == "upload_not_found"


def test_complete_twice_is_409(api, s3):
    res = api.post("/api/v1/routes/uploads", json={"fileSize": len(GPX)})
    body = res.json()
    s3.put_object(Bucket=BUCKET, Key=body["fields"]["key"], Body=GPX)
    assert api.post("/api/v1/routes", json={"uploadId": body["uploadId"]}).status_code == 201
    res = api.post("/api/v1/routes", json={"uploadId": body["uploadId"]})
    assert res.status_code == 409


def test_file_too_large_is_413(api):
    res = api.post("/api/v1/routes/uploads", json={"fileSize": 4096})
    assert res.status_code == 413
    assert res.json()["error"]["code"] == "file_too_large"


def test_route_limit(api, s3):
    assert upload(api, s3).status_code == 201
    assert upload(api, s3).status_code == 201
    res = api.post("/api/v1/routes/uploads", json={"fileSize": 10})
    assert res.status_code == 409
    assert res.json()["error"]["code"] == "route_limit_reached"


def test_delete_frees_quota_and_removes_file(api, s3):
    first = upload(api, s3).json()
    upload(api, s3)
    assert api.delete(f"/api/v1/routes/{first['id']}").status_code == 204
    assert s3.list_objects_v2(Bucket=BUCKET)["KeyCount"] == 1
    assert len(api.get("/api/v1/routes").json()["routes"]) == 1
    assert upload(api, s3).status_code == 201
    assert api.get(f"/api/v1/routes/{first['id']}/gpx").status_code == 404


def test_download_url(api, s3):
    route = upload(api, s3).json()
    res = api.get(f"/api/v1/routes/{route['id']}/gpx")
    assert res.status_code == 200
    url = res.json()["url"]
    assert url.startswith(f"https://{BUCKET}.s3.ap-northeast-1.amazonaws.com/users/1/routes/")
    assert "X-Amz-Signature" in url


def test_other_users_route_is_404(api, s3):
    route = upload(api, s3).json()
    login(api, "valid:uid-2")
    assert api.get(f"/api/v1/routes/{route['id']}/gpx").status_code == 404
    assert api.delete(f"/api/v1/routes/{route['id']}").status_code == 404
    assert api.get("/api/v1/routes").json()["routes"] == []


def test_requires_login(client):
    client.cookies.clear()
    assert client.get("/api/v1/routes").status_code == 401


def test_storage_not_configured_is_503(client):
    login(client)
    res = client.post("/api/v1/routes/uploads", json={"fileSize": 10})
    assert res.status_code == 503
    assert res.json()["error"]["code"] == "storage_unavailable"
