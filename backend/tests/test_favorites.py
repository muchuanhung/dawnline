"""收藏：公開路線與自己的私人路線可收藏，別人的私人路線 404；冪等、上限、刪除時清掉。"""

from pathlib import Path

from app.core.config import Settings, get_settings
from app.scripts import import_public_routes
from app.services.storage import GpxStorage
from tests.conftest import login
from tests.test_routes import BUCKET, GPX, api, s3, upload  # noqa: F401 - fixtures


def _publish(session_factory, s3, tmp_path: Path, *slugs: str) -> None:  # noqa: F811
    folder = tmp_path / "gpx"
    folder.mkdir(exist_ok=True)
    for slug in slugs:
        (folder / f"{slug}.gpx").write_bytes(GPX)
    with session_factory() as db:
        import_public_routes.run(db, GpxStorage(s3, BUCKET), folder, "uid-1", max_bytes=2048)
        db.commit()


def _ids(api) -> list[str]:  # noqa: F811
    res = api.get("/api/v1/favorites")
    assert res.status_code == 200, res.text
    return [f["id"] for f in res.json()["favorites"]]


def test_favorite_public_and_own_private(api, s3, session_factory, tmp_path):  # noqa: F811
    _publish(session_factory, s3, tmp_path, "yangjin")
    private_id = upload(api, s3).json()["id"]

    assert api.put("/api/v1/favorites/yangjin").status_code == 204
    assert api.put(f"/api/v1/favorites/{private_id}").status_code == 204
    assert api.put("/api/v1/favorites/yangjin").status_code == 204  # 冪等
    assert _ids(api) == [private_id, "yangjin"]  # 新的在前

    body = api.get("/api/v1/favorites").json()
    assert {f["visibility"] for f in body["favorites"]} == {"public", "private"}
    assert body["limit"] == 50

    assert api.delete("/api/v1/favorites/yangjin").status_code == 204
    assert api.delete("/api/v1/favorites/yangjin").status_code == 204  # 冪等
    assert _ids(api) == [private_id]


def test_other_users_private_route_is_404(api, s3):  # noqa: F811
    private_id = upload(api, s3).json()["id"]
    login(api, "valid:uid-2")
    assert api.put(f"/api/v1/favorites/{private_id}").status_code == 404
    assert api.put("/api/v1/favorites/does-not-exist").status_code == 404


def test_deleting_private_route_removes_favorite(api, s3):  # noqa: F811
    private_id = upload(api, s3).json()["id"]
    api.put(f"/api/v1/favorites/{private_id}")
    assert api.delete(f"/api/v1/routes/{private_id}").status_code == 204
    assert _ids(api) == []


def test_unpublished_public_route_disappears(api, s3, session_factory, tmp_path):  # noqa: F811
    _publish(session_factory, s3, tmp_path, "a", "b")
    api.put("/api/v1/favorites/a")
    api.put("/api/v1/favorites/b")
    with session_factory() as db:
        from app.services import public_route_service

        public_route_service.unpublish_missing(db, GpxStorage(s3, BUCKET), {"a"})
        db.commit()
    assert _ids(api) == ["a"]


def test_favorite_limit(api, s3, session_factory, tmp_path):  # noqa: F811
    _publish(session_factory, s3, tmp_path, "a", "b")
    limited = Settings(
        database_url="sqlite://",
        session_cookie_secure=False,
        s3_bucket=BUCKET,
        favorites_max_per_user=1,
    )
    api.app.dependency_overrides[get_settings] = lambda: limited
    assert api.put("/api/v1/favorites/a").status_code == 204
    res = api.put("/api/v1/favorites/b")
    assert res.status_code == 409
    assert res.json()["error"]["code"] == "favorite_limit_reached"


def test_requires_login(client):
    assert client.get("/api/v1/favorites").status_code == 401
    assert client.put("/api/v1/favorites/a").status_code == 401
