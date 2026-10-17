from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "mysql+pymysql://velorder:velorder@localhost:3306/velorder?charset=utf8mb4"
    firebase_project_id: str = ""

    session_cookie_name: str = "rc_session"
    # 正式環境（HTTPS）必須為 true；本機 http 開發才設 false
    session_cookie_secure: bool = True
    session_ttl_days: int = 7

    # GPX 存放的 S3 bucket；空字串代表未設定，上傳相關 API 回 503
    s3_bucket: str = ""
    s3_region: str = "ap-northeast-1"
    gpx_max_bytes: int = 5 * 1024 * 1024
    gpx_max_routes_per_user: int = 10
    # presigned URL 有效秒數
    s3_upload_expires_seconds: int = 300
    s3_download_expires_seconds: int = 300

    @property
    def session_ttl_seconds(self) -> int:
        return self.session_ttl_days * 24 * 60 * 60


@lru_cache
def get_settings() -> Settings:
    return Settings()
