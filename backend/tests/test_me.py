from datetime import timedelta

from sqlalchemy import select

from app.core.db import utcnow
from app.models import AuthSession
from tests.conftest import COOKIE, login


def test_me_with_valid_cookie(client):
    login(client)
    res = client.get("/api/v1/me")
    assert res.status_code == 200
    assert res.json()["email"] == "uid-1@example.com"


def test_me_without_cookie_is_401(client):
    res = client.get("/api/v1/me")
    assert res.status_code == 401
    assert res.json()["error"]["code"] == "unauthenticated"


def test_me_with_unknown_cookie_is_401(client):
    client.cookies.set(COOKIE, "not-a-real-session")
    assert client.get("/api/v1/me").status_code == 401


def test_me_after_logout_is_401(client):
    raw = login(client)
    client.delete("/api/v1/auth/session")
    client.cookies.set(COOKIE, raw)  # 即使客戶端還留著舊 cookie
    assert client.get("/api/v1/me").status_code == 401


def test_me_with_expired_session_is_401(client, db):
    login(client)
    session = db.scalar(select(AuthSession))
    session.expires_at = utcnow() - timedelta(seconds=1)
    db.commit()
    assert client.get("/api/v1/me").status_code == 401


def test_me_slides_expiry_forward(client, db):
    login(client)
    session = db.scalar(select(AuthSession))
    session.expires_at = utcnow() + timedelta(hours=1)
    db.commit()

    res = client.get("/api/v1/me")
    assert res.status_code == 200
    assert "Max-Age=604800" in res.headers["set-cookie"]

    db.expire_all()
    remaining = db.scalar(select(AuthSession.expires_at)) - utcnow()
    assert timedelta(days=6, hours=23) < remaining <= timedelta(days=7)


def test_me_with_non_ascii_cookie_is_401_not_500(client):
    # 被竄改成非 ASCII 的 cookie：查不到 session 就是未登入，不能 UnicodeEncodeError 變 500
    bad = {"cookie": "rc_session=caf\xe9".encode("latin-1")}
    res = client.get("/api/v1/me", headers=bad)
    assert res.status_code == 401
    res = client.delete("/api/v1/auth/session", headers=bad)
    assert res.status_code == 204


def test_fresh_session_is_not_rewritten_on_every_request(client, db):
    """效期還剩一半以上就不延長：不寫資料庫、不重設 cookie。"""
    login(client)
    before = db.scalar(select(AuthSession.expires_at))
    res = client.get("/api/v1/me")
    assert res.status_code == 200
    assert "set-cookie" not in res.headers
    db.expire_all()
    assert db.scalar(select(AuthSession.expires_at)) == before
