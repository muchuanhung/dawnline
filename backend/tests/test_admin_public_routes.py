"""管理員在網站上新增／下架公開路線：權限、上傳、覆寫、下架、/me 的 isAdmin。"""

import pytest

from app.core.config import Settings, get_settings
from app.services.storage import GpxStorage, get_storage
from tests import test_routes
from tests.conftest import login
from tests.test_routes import BUCKET, GPX

s3 = test_routes.s3

GPX_V2 = GPX.replace(b"<ele>500</ele>", b"<ele>600</ele>")
ADMIN_UID = "uid-admin"


@pytest.fixture
def admin(client, s3):
    """管理員已登入的 client（ADMIN_FIREBASE_UIDS 只有 uid-admin）。"""
    test_settings = Settings(
        database_url="sqlite://",
        session_cookie_secure=False,
        s3_bucket=BUCKET,
        gpx_max_bytes=2048,
        gpx_max_routes_per_user=2,
        admin_firebase_uids=f" {ADMIN_UID} , other-admin",
    )
    client.app.dependency_overrides[get_settings] = lambda: test_settings
    client.app.dependency_overrides[get_storage] = lambda: GpxStorage(s3, BUCKET)
    login(client, f"valid:{ADMIN_UID}")
    return client


def publish(client, s3, slug: str, data: bytes = GPX):
    res = client.post("/api/v1/admin/public-routes/uploads", json={"fileSize": len(data)})
    assert res.status_code == 201, res.text
    body = res.json()
    s3.put_object(Bucket=BUCKET, Key=body["fields"]["key"], Body=data)
    return client.post(
        "/api/v1/admin/public-routes", json={"uploadId": body["uploadId"], "slug": slug}
    )


def _keys(s3) -> list[str]:
    return [o["Key"] for o in s3.list_objects_v2(Bucket=BUCKET).get("Contents", [])]


def test_me_reports_admin(admin):
    assert admin.get("/api/v1/me").json()["isAdmin"] is True
    login(admin, "valid:rider")
    assert admin.get("/api/v1/me").json()["isAdmin"] is False


def test_non_admin_is_forbidden(admin, s3):
    login(admin, "valid:rider")
    res = admin.post("/api/v1/admin/public-routes/uploads", json={"fileSize": 100})
    assert res.status_code == 403
    assert res.json()["error"]["code"] == "forbidden"
    assert admin.delete("/api/v1/admin/public-routes/x").status_code == 403
    admin.cookies.clear()
    res = admin.post("/api/v1/admin/public-routes/uploads", json={"fileSize": 1})
    assert res.status_code == 401


def test_publish_lists_publicly_and_cleans_temp_file(admin, s3):
    res = publish(admin, s3, "新路線 (北海岸)")
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["action"] == "created"
    assert body["route"]["id"] == "新路線 (北海岸)"
    assert body["route"]["name"] == "陽金公路"
    assert len(_keys(s3)) == 1  # temp upload removed, only the route's own file left

    admin.cookies.clear()
    (route,) = admin.get("/api/v1/public-routes").json()["routes"]
    assert route["id"] == "新路線 (北海岸)"


def test_public_routes_skip_quota(admin, s3):
    for slug in ("a", "b", "c"):  # quota is 2 for private routes
        assert publish(admin, s3, slug).status_code == 200
    assert admin.get("/api/v1/routes").json()["routes"] == []


def test_same_slug_overwrites_and_keeps_favourites(admin, s3):
    assert publish(admin, s3, "yangjin").json()["action"] == "created"
    assert admin.put("/api/v1/favorites/yangjin").status_code in (200, 201, 204)
    assert publish(admin, s3, "yangjin").json()["action"] == "unchanged"
    res = publish(admin, s3, "yangjin", GPX_V2)
    assert res.json()["action"] == "updated"
    assert res.json()["route"]["elevationGainM"] == 220
    assert [f["id"] for f in admin.get("/api/v1/favorites").json()["favorites"]] == ["yangjin"]
    assert len(_keys(s3)) == 1


def test_invalid_slug_and_gpx_are_rejected(admin, s3):
    res = publish(admin, s3, "a/b")
    assert res.status_code == 422
    assert res.json()["error"]["code"] == "invalid_slug"
    res = publish(admin, s3, "broken", b"<gpx")
    assert res.status_code == 422
    assert res.json()["error"]["code"] == "invalid_gpx"
    assert _keys(s3) == []
    res = admin.post("/api/v1/admin/public-routes", json={"uploadId": "0" * 26, "slug": "nope"})
    assert res.status_code == 404


def test_unpublish(admin, s3):
    publish(admin, s3, "yangjin")
    publish(admin, s3, "wuling")
    admin.put("/api/v1/favorites/yangjin")
    assert admin.delete("/api/v1/admin/public-routes/yangjin").status_code == 204
    ids = [r["id"] for r in admin.get("/api/v1/public-routes").json()["routes"]]
    assert ids == ["wuling"]
    assert admin.get("/api/v1/favorites").json()["favorites"] == []
    assert len(_keys(s3)) == 1
    assert admin.delete("/api/v1/admin/public-routes/yangjin").status_code == 404
    # Re-publishing an unpublished slug brings it back
    assert publish(admin, s3, "yangjin").status_code == 200
