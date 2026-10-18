"""verify_firebase_id_token：不連 Google，替換 verify_firebase_token 只測 iss／sub 與錯誤轉換。"""

import pytest

from app.core import firebase
from app.core.config import Settings

PROJECT = "demo-project"


@pytest.fixture(autouse=True)
def project_settings(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(firebase, "get_settings", lambda: Settings(firebase_project_id=PROJECT))


def _stub(monkeypatch: pytest.MonkeyPatch, result=None, exc: Exception | None = None) -> list:
    calls: list = []

    def fake(token, request, audience=None, clock_skew_in_seconds=0):
        calls.append(audience)
        if exc:
            raise exc
        return result

    monkeypatch.setattr(firebase.google_id_token, "verify_firebase_token", fake)
    return calls


def _claims(**overrides) -> dict:
    claims = {
        "iss": f"https://securetoken.google.com/{PROJECT}",
        "aud": PROJECT,
        "sub": "uid-1",
        "email": "a@example.com",
        "name": "Rider",
    }
    claims.update(overrides)
    return claims


def test_valid_token_returns_identity(monkeypatch):
    calls = _stub(monkeypatch, result=_claims())
    identity = firebase.verify_firebase_id_token("tok")
    assert identity == firebase.FirebaseIdentity("uid-1", "a@example.com", "Rider")
    assert calls == [PROJECT]


def test_wrong_issuer_rejected(monkeypatch):
    _stub(monkeypatch, result=_claims(iss="https://securetoken.google.com/other"))
    with pytest.raises(firebase.InvalidIdTokenError):
        firebase.verify_firebase_id_token("tok")


@pytest.mark.parametrize("sub", [None, "", "x" * 129])
def test_bad_subject_rejected(monkeypatch, sub):
    _stub(monkeypatch, result=_claims(sub=sub))
    with pytest.raises(firebase.InvalidIdTokenError):
        firebase.verify_firebase_id_token("tok")


def test_signature_or_audience_failure_maps_to_invalid(monkeypatch):
    _stub(monkeypatch, exc=ValueError("Token has wrong audience"))
    with pytest.raises(firebase.InvalidIdTokenError):
        firebase.verify_firebase_id_token("tok")


def test_missing_project_id_is_config_error(monkeypatch):
    monkeypatch.setattr(firebase, "get_settings", lambda: Settings(firebase_project_id=""))
    with pytest.raises(RuntimeError):
        firebase.verify_firebase_id_token("tok")
