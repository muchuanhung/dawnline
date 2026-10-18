"""Firebase ID token 驗證。只在 POST /auth/session 用到，之後的請求一律看自有 session。

直接用 google-auth 對 Google 公鑰驗簽，不經 firebase-admin：後者會去找
Application Default Credentials，在沒有 GCP 服務帳號的 EC2 上會失敗。
"""

from collections.abc import Callable
from dataclasses import dataclass
from functools import lru_cache

import google.auth.exceptions
import google.auth.transport.requests
import requests
from google.oauth2 import id_token as google_id_token

from app.core.config import get_settings


class InvalidIdTokenError(Exception):
    pass


@dataclass(frozen=True)
class FirebaseIdentity:
    uid: str
    email: str | None
    display_name: str | None


TokenVerifier = Callable[[str], FirebaseIdentity]


@lru_cache
def _http_request() -> google.auth.transport.requests.Request:
    # 共用連線抓 securetoken 公鑰
    return google.auth.transport.requests.Request(session=requests.Session())


def verify_firebase_id_token(id_token: str) -> FirebaseIdentity:
    """驗證簽章、aud、iss、exp 與 sub；失敗丟 InvalidIdTokenError。"""
    project_id = get_settings().firebase_project_id
    if not project_id:
        raise RuntimeError("FIREBASE_PROJECT_ID 未設定")
    try:
        # 驗簽章、exp、iat 與 aud（= project_id）
        decoded = google_id_token.verify_firebase_token(
            id_token, _http_request(), audience=project_id, clock_skew_in_seconds=10
        )
    except (ValueError, google.auth.exceptions.GoogleAuthError) as e:
        raise InvalidIdTokenError(str(e)) from e
    if not decoded:
        raise InvalidIdTokenError("empty token payload")

    # verify_firebase_token 不檢查 iss 與 sub，依 Firebase 規範補上
    if decoded.get("iss") != f"https://securetoken.google.com/{project_id}":
        raise InvalidIdTokenError("invalid issuer")
    uid = decoded.get("sub")
    if not isinstance(uid, str) or not uid or len(uid) > 128:
        raise InvalidIdTokenError("invalid subject")

    return FirebaseIdentity(
        uid=uid,
        email=decoded.get("email"),
        display_name=decoded.get("name"),
    )


def get_token_verifier() -> TokenVerifier:
    return verify_firebase_id_token
