"""GPX 檔的 S3 存取：presigned POST 上傳、讀檔、presigned GET 下載、刪除。

瀏覽器直傳 S3，檔案不經過 API；API 只發 URL、事後讀檔驗證。
EC2 上用 instance role 取得權限（boto3 預設憑證鏈），不在設定裡放 access key。
"""

from dataclasses import dataclass
from functools import lru_cache
from urllib.parse import quote

import boto3
from botocore.client import BaseClient
from botocore.config import Config
from botocore.exceptions import ClientError

from app.core.config import get_settings
from app.core.errors import ApiError

GPX_CONTENT_TYPE = "application/gpx+xml"


def gpx_key(user_id: int, route_public_id: str) -> str:
    """S3 key 由 user 與 route id 推得，前端無法指定。"""
    return f"users/{user_id}/routes/{route_public_id}.gpx"


@dataclass(frozen=True)
class PresignedUpload:
    url: str
    fields: dict[str, str]


class GpxStorage:
    def __init__(self, client: BaseClient, bucket: str) -> None:
        self.client = client
        self.bucket = bucket

    def presign_upload(self, key: str, max_bytes: int, expires: int) -> PresignedUpload:
        # policy 限定 key、Content-Type 與大小，超過的檔案 S3 直接拒收
        post = self.client.generate_presigned_post(
            Bucket=self.bucket,
            Key=key,
            Fields={"Content-Type": GPX_CONTENT_TYPE},
            Conditions=[
                {"Content-Type": GPX_CONTENT_TYPE},
                ["content-length-range", 1, max_bytes],
            ],
            ExpiresIn=expires,
        )
        return PresignedUpload(url=post["url"], fields=post["fields"])

    def read(self, key: str, max_bytes: int) -> bytes | None:
        """讀整檔；不存在回 None。超過上限丟 ApiError（理論上已被 policy 擋下）。"""
        try:
            head = self.client.head_object(Bucket=self.bucket, Key=key)
        except ClientError as e:
            if e.response.get("Error", {}).get("Code") in ("404", "NoSuchKey", "NotFound"):
                return None
            raise
        if head["ContentLength"] > max_bytes:
            raise ApiError(413, "file_too_large", "GPX 檔案超過大小上限")
        obj = self.client.get_object(Bucket=self.bucket, Key=key)
        return obj["Body"].read()

    def presign_download(self, key: str, filename: str, expires: int) -> str:
        # 中文檔名用 RFC 5987 的 filename*
        disposition = f"attachment; filename*=UTF-8''{quote(filename)}"
        return self.client.generate_presigned_url(
            "get_object",
            Params={
                "Bucket": self.bucket,
                "Key": key,
                "ResponseContentDisposition": disposition,
                "ResponseContentType": GPX_CONTENT_TYPE,
            },
            ExpiresIn=expires,
        )

    def delete(self, key: str) -> None:
        self.client.delete_object(Bucket=self.bucket, Key=key)


def build_s3_client(region: str) -> BaseClient:
    # 指定 regional endpoint 與 SigV4，presigned URL 才不會被 307 轉址導致 CORS 失敗
    return boto3.client(
        "s3",
        region_name=region,
        endpoint_url=f"https://s3.{region}.amazonaws.com",
        config=Config(signature_version="s3v4", s3={"addressing_style": "virtual"}),
    )


@lru_cache
def _default_storage(bucket: str, region: str) -> GpxStorage:
    return GpxStorage(build_s3_client(region), bucket)


def get_storage() -> GpxStorage:
    settings = get_settings()
    if not settings.s3_bucket:
        raise ApiError(503, "storage_unavailable", "S3 尚未設定")
    return _default_storage(settings.s3_bucket, settings.s3_region)
