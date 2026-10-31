"""公開路線：匯入腳本、不需登入的清單與 GPX 下載、不算配額。"""

from pathlib import Path

from app.scripts import import_public_routes
from app.services.storage import GpxStorage
from tests import test_routes
from tests.conftest import login
from tests.test_routes import BUCKET, GPX, upload

# 共用 test_routes 的 fixture（假 S3、已登入 client）；用指派而非 import，
# 測試參數同名時 ruff 才不會當成重複定義
api = test_routes.api
s3 = test_routes.s3

GPX_V2 = GPX.replace(b"<ele>500</ele>", b"<ele>600</ele>")


def _write(folder: Path, files: dict[str, bytes]) -> Path:
    folder.mkdir(exist_ok=True)
    for name, data in files.items():
        (folder / name).write_bytes(data)
    return folder


def _import(session_factory, s3, folder: Path, **kw) -> int:
    with session_factory() as db:
        failures = import_public_routes.run(
            db, GpxStorage(s3, BUCKET), folder, "uid-1", max_bytes=2048, **kw
        )
        db.commit()
    return failures


def test_import_then_list_without_login(api, s3, session_factory, tmp_path, capsys):
    folder = _write(tmp_path / "gpx", {"yangjin.gpx": GPX, "bad.gpx": b"<gpx"})
    assert _import(session_factory, s3, folder) == 1  # bad.gpx 失敗但不影響其他檔
    assert "created   yangjin" in capsys.readouterr().out

    api.cookies.clear()
    res = api.get("/api/v1/public-routes")
    assert res.status_code == 200
    (route,) = res.json()["routes"]
    assert route["id"] == "yangjin"
    assert route["name"] == "陽金公路"
    assert route["elevationGainM"] == 120

    res = api.get("/api/v1/public-routes/yangjin/gpx")
    assert res.status_code == 200
    assert "X-Amz-Signature" in res.json()["url"]
    assert api.get("/api/v1/public-routes/nope/gpx").status_code == 404


def test_reimport_is_idempotent_and_updates_changed_file(
    api,
    s3,
    session_factory,
    tmp_path,
    capsys,
):
    folder = _write(tmp_path / "gpx", {"yangjin.gpx": GPX})
    _import(session_factory, s3, folder)
    _import(session_factory, s3, folder)
    assert "unchanged yangjin" in capsys.readouterr().out

    _write(folder, {"yangjin.gpx": GPX_V2})
    _import(session_factory, s3, folder)
    assert "updated   yangjin" in capsys.readouterr().out
    (route,) = api.get("/api/v1/public-routes").json()["routes"]
    assert route["elevationGainM"] == 220


def test_prune_unpublishes_missing(api, s3, session_factory, tmp_path):
    _import(session_factory, s3, _write(tmp_path / "a", {"a.gpx": GPX, "b.gpx": GPX}))
    _import(session_factory, s3, _write(tmp_path / "b", {"a.gpx": GPX}), prune=True)
    ids = [r["id"] for r in api.get("/api/v1/public-routes").json()["routes"]]
    assert ids == ["a"]
    assert api.get("/api/v1/public-routes/b/gpx").status_code == 404


def test_public_routes_not_in_owner_list_or_quota(api, s3, session_factory, tmp_path):
    # 測試配額每人 2 條；擁有者掛了 3 條公開路線仍可上傳
    files = {f"r{i}.gpx": GPX for i in range(3)}
    _import(session_factory, s3, _write(tmp_path / "gpx", files))
    assert api.get("/api/v1/routes").json()["routes"] == []
    assert upload(api, s3).status_code == 201


def test_unknown_owner_fails(client, s3, session_factory, tmp_path):
    login(client, "valid:someone-else")
    assert _import(session_factory, s3, _write(tmp_path / "gpx", {"a.gpx": GPX})) == 1
    assert client.get("/api/v1/public-routes").json()["routes"] == []
