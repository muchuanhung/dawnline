"""「我的路線」自訂順序：整份取代、跨請求保留、略過看不到的路線、刪路線時清掉。"""

from app.services.storage import GpxStorage
from tests import test_routes
from tests.conftest import login
from tests.test_favorites import _publish
from tests.test_routes import BUCKET, upload

# 共用 test_routes 的 fixture（假 S3、已登入 client）
api = test_routes.api
s3 = test_routes.s3

URL = "/api/v1/me/route-order"


def _order(api) -> list[str]:
    res = api.get(URL)
    assert res.status_code == 200, res.text
    return res.json()["ids"]


def test_empty_until_saved(api):
    assert _order(api) == []


def test_put_replaces_whole_order(api, s3, session_factory, tmp_path):
    _publish(session_factory, s3, tmp_path, "a", "b")
    private_id = upload(api, s3).json()["id"]

    res = api.put(URL, json={"ids": [private_id, "b", "a"]})
    assert res.status_code == 200, res.text
    assert res.json()["ids"] == [private_id, "b", "a"]
    assert _order(api) == [private_id, "b", "a"]

    # 第二次整份取代，不是合併
    assert api.put(URL, json={"ids": ["a", private_id]}).json()["ids"] == ["a", private_id]
    assert _order(api) == ["a", private_id]


def test_skips_unknown_duplicate_and_others_private(api, s3, session_factory, tmp_path):
    _publish(session_factory, s3, tmp_path, "a")
    other_private = upload(api, s3).json()["id"]
    login(api, "valid:uid-2")
    res = api.put(URL, json={"ids": ["a", "missing", other_private, "a"]})
    assert res.status_code == 200
    assert res.json()["ids"] == ["a"]


def test_order_is_per_user(api, s3, session_factory, tmp_path):
    _publish(session_factory, s3, tmp_path, "a", "b")
    api.put(URL, json={"ids": ["b", "a"]})
    login(api, "valid:uid-2")
    assert _order(api) == []


def test_deleted_and_unpublished_routes_drop_out(api, s3, session_factory, tmp_path):
    _publish(session_factory, s3, tmp_path, "a", "b")
    private_id = upload(api, s3).json()["id"]
    api.put(URL, json={"ids": [private_id, "b", "a"]})

    assert api.delete(f"/api/v1/routes/{private_id}").status_code == 204
    with session_factory() as db:
        from app.services import public_route_service

        public_route_service.unpublish_missing(db, GpxStorage(s3, BUCKET), {"a"})
        db.commit()
    assert _order(api) == ["a"]


def test_rejects_oversized_body(api):
    assert api.put(URL, json={"ids": [f"r{i}" for i in range(101)]}).status_code == 422


def test_requires_login(client):
    assert client.get(URL).status_code == 401
    assert client.put(URL, json={"ids": []}).status_code == 401
