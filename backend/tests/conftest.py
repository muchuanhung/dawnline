"""測試用 SQLite 記憶體 DB + 假的 Firebase 驗證，不連 MySQL、不連 Firebase。

空間欄位在 SQLite 以 WKT 文字存放（app/core/types.py），所以 routes 也在 SQLite 建；
segments、cctv 尚無 API，不建。真正的 MySQL schema 在 CI 的 MySQL 容器上驗。
"""

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.config import Settings, get_settings
from app.core.db import Base, get_db
from app.core.firebase import FirebaseIdentity, InvalidIdTokenError, get_token_verifier
from app.main import create_app
from app.models import AuthSession, Route, User

COOKIE = "rc_session"


def fake_verify(id_token: str) -> FirebaseIdentity:
    """'valid:<uid>[:<email>]' 視為合法 token，其餘一律驗證失敗。"""
    parts = id_token.split(":")
    if parts[0] != "valid" or len(parts) < 2:
        raise InvalidIdTokenError("bad token")
    email = parts[2] if len(parts) > 2 else f"{parts[1]}@example.com"
    return FirebaseIdentity(uid=parts[1], email=email, display_name=f"Rider {parts[1]}")


@pytest.fixture
def settings() -> Settings:
    # TestClient 走 http，Secure cookie 不會被送回，所以測試預設關掉
    return Settings(database_url="sqlite://", session_cookie_secure=False)


@pytest.fixture
def session_factory() -> Iterator[sessionmaker[Session]]:
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(
        engine, tables=[User.__table__, AuthSession.__table__, Route.__table__]
    )
    yield sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    engine.dispose()


@pytest.fixture
def db(session_factory) -> Iterator[Session]:
    with session_factory() as s:
        yield s


@pytest.fixture
def client(settings, session_factory) -> Iterator[TestClient]:
    app = create_app()

    def _get_db():
        with session_factory() as s:
            yield s

    app.dependency_overrides[get_db] = _get_db
    app.dependency_overrides[get_settings] = lambda: settings
    app.dependency_overrides[get_token_verifier] = lambda: fake_verify
    with TestClient(app) as c:
        yield c


def login(client: TestClient, token: str = "valid:uid-1") -> str:
    res = client.post("/api/v1/auth/session", json={"idToken": token})
    assert res.status_code == 200, res.text
    return res.cookies[COOKIE]
