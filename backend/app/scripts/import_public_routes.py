"""匯入公開路線：把一個資料夾的 GPX 寫進 S3 與 routes（visibility='public'）。

檔名（去掉 .gpx）就是 slug，也就是前端的路線 id；與原 Firebase Storage gpx/routes/ 的檔名一致，
網址與判讀快取都不用改。重跑安全：內容沒變的檔案不動，改過的覆寫同一個 S3 key。

用法（EC2，在 API 容器裡跑，用 instance role 寫 S3）：
    docker cp ./public-gpx velorder-api:/tmp/public-gpx
    docker exec velorder-api python -m app.scripts.import_public_routes \\
        /tmp/public-gpx --owner-uid <你的 Firebase UID> [--prune] [--dry-run]

--owner-uid：公開路線掛在誰名下（必須登入過一次，users 才有這筆）；不算這個人的配額。
--prune：資料夾裡沒有的公開路線一併下架（軟刪除、刪 S3 檔、清收藏）。
--dry-run：只解析與比對，不寫 S3 也不 commit。
"""

import argparse
import sys
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.db import get_sessionmaker
from app.models import User
from app.services import public_route_service
from app.services.gpx import InvalidGpxError
from app.services.storage import GpxStorage, get_storage


class _DryRunStorage(GpxStorage):
    """dry-run 時不碰 S3。"""

    def __init__(self) -> None:  # noqa: D107 - 不需要 client
        pass

    def put(self, key: str, data: bytes) -> None:
        return None

    def delete(self, key: str) -> None:
        return None


def run(
    db: Session,
    storage: GpxStorage,
    folder: Path,
    owner_uid: str,
    *,
    prune: bool = False,
    max_bytes: int,
) -> int:
    """回傳失敗檔案數；呼叫端決定 commit 或 rollback。"""
    owner = db.scalar(select(User).where(User.firebase_uid == owner_uid))
    if owner is None:
        print(f"找不到 firebase_uid={owner_uid} 的使用者（先用這個帳號登入一次）", file=sys.stderr)
        return 1

    failures = 0
    seen: set[str] = set()
    for path in sorted(folder.glob("*.gpx")):
        slug = path.stem
        data = path.read_bytes()
        if len(data) > max_bytes:
            print(f"跳過 {path.name}：超過 {max_bytes} bytes", file=sys.stderr)
            failures += 1
            continue
        try:
            result = public_route_service.import_public_route(db, storage, owner, slug, data)
        except (InvalidGpxError, ValueError) as e:
            print(f"跳過 {path.name}：{e}", file=sys.stderr)
            failures += 1
            continue
        seen.add(slug)
        print(f"{result.action:9} {slug}")

    if prune:
        for slug in public_route_service.unpublish_missing(db, storage, seen):
            print(f"{'removed':9} {slug}")
    return failures


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="匯入公開路線 GPX")
    parser.add_argument("folder", type=Path)
    parser.add_argument("--owner-uid", required=True)
    parser.add_argument("--prune", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)

    if not args.folder.is_dir():
        print(f"{args.folder} 不是資料夾", file=sys.stderr)
        return 2
    settings = get_settings()
    storage = _DryRunStorage() if args.dry_run else get_storage()
    with get_sessionmaker()() as db:
        failures = run(
            db,
            storage,
            args.folder,
            args.owner_uid,
            prune=args.prune,
            max_bytes=settings.gpx_max_bytes,
        )
        if args.dry_run:
            db.rollback()
            print("dry-run：沒有寫入")
        else:
            db.commit()
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
