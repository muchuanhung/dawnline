"""T7 索引調校：灌一批假資料，對 API 實際送出的 SQL 跑 EXPLAIN，比較「有索引／不用索引」的執行計畫。

只在空的 MySQL 上跑（CI 的 MySQL 容器、本機 docker compose），會寫入數萬筆假資料，
所以 users 表不是空的就直接拒絕，避免誤灌到正式機。

SQL 不是手寫的：每個情境呼叫 service 層的真實函式，用 SQLAlchemy 的 before_cursor_execute
攔下實際送出的語句與參數，再拿去 EXPLAIN。之後 service 改了查詢，這份報告會跟著變。

「不用索引」用 MySQL 8 的 optimizer hint `/*+ NO_INDEX(table index) */`，不必真的 DROP INDEX
（有些索引是 FK 必需的，MySQL 不准刪）。

用法：
    python -m app.scripts.explain_queries [--users 5000] [--runs 30] [--output report.md]

結束碼：任何一條查詢在「有索引」時沒用上預期的索引就回 1，讓 CI 轉紅。
"""

import argparse
import re
import statistics
import sys
import time
from collections.abc import Callable
from contextlib import contextmanager
from dataclasses import dataclass, field
from pathlib import Path

from sqlalchemy import Engine, event, func, select, text
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.db import get_engine, get_sessionmaker
from app.models import Route, User
from app.services import favorite_service, public_route_service, route_service
from app.services.storage import GpxStorage

PUBLIC_ROUTES = 200  # 公開路線數（目前線上 4 條，抓日後規模）
PRIVATE_PER_USER = 12  # 每人 12 條私人路線，其中 2 條已軟刪除（配額 10）
PUBLIC_FAVS_PER_USER = 15  # 每人收藏 15 條公開路線，另加約 1/4 自己的私人路線
BBOX_WKT = "POLYGON((121.5 25.1,121.6 25.1,121.6 25.2,121.5 25.2,121.5 25.1))"
EXPLAIN_COLUMNS = ("table", "type", "key", "rows", "filtered", "Extra")


# ---------------------------------------------------------------- seed


def seed(db: Session, users: int) -> None:
    """用遞迴 CTE 在 MySQL 端一次產生資料，比逐筆 INSERT 快很多。"""
    db.execute(text("SET SESSION cte_max_recursion_depth = 1000000"))
    db.execute(
        text("""
INSERT INTO users (firebase_uid, created_at, last_login_at)
WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < :users)
SELECT CONCAT('explain-seed-', n), NOW(3), NOW(3) FROM seq
"""),
        {"users": users},
    )
    owner_id = db.scalar(text("SELECT MIN(id) FROM users"))
    bbox = "ST_GeomFromText(:wkt, 4326, 'axis-order=long-lat')"

    # 公開路線：掛在第一位使用者名下，約 5% 已下架
    db.execute(
        text(f"""
INSERT INTO routes (public_id, user_id, name, route_type, visibility, slug, s3_key, file_size,
                    file_sha256, status, distance_km, elevation_gain_m, bbox, created_at,
                    updated_at, deleted_at)
WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < :n)
SELECT LPAD(CONCAT('9', n), 26, '0'), :owner, CONCAT('公開路線 ', MD5(n)), '自行車', 'public',
       CONCAT('seed-public-', n), CONCAT('seed/', n), 1000, REPEAT('0', 64), 'ready', 42.0, 500,
       {bbox}, NOW(3), NOW(3), IF(n % 20 = 0, NOW(3), NULL)
FROM seq
"""),
        {"n": PUBLIC_ROUTES, "owner": owner_id, "wkt": BBOX_WKT},
    )

    # 私人路線：每人 PRIVATE_PER_USER 條，最後 2 條已軟刪除；少數仍在 processing
    db.execute(
        text(f"""
INSERT INTO routes (public_id, user_id, name, route_type, visibility, slug, s3_key, file_size,
                    file_sha256, status, distance_km, elevation_gain_m, bbox, created_at,
                    updated_at, deleted_at)
WITH RECURSIVE k(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM k WHERE n < :per_user)
SELECT LPAD(CONCAT(u.id, 'X', k.n), 26, '0'), u.id, CONCAT('我的路線 ', MD5(u.id * 100 + k.n)),
       '自行車', 'private', NULL, CONCAT('seed/', u.id, '/', k.n), 1000, REPEAT('0', 64),
       IF(k.n = 1 AND u.id % 10 = 0, 'processing', 'ready'), 30.0, 300, {bbox},
       NOW(3) - INTERVAL (u.id * :per_user + k.n) MINUTE, NOW(3),
       IF(k.n > :per_user - 2, NOW(3), NULL)
FROM users u CROSS JOIN k
WHERE u.id <> :owner
"""),
        {"per_user": PRIVATE_PER_USER, "owner": owner_id, "wkt": BBOX_WKT},
    )

    # 收藏：每人 PUBLIC_FAVS_PER_USER 條公開路線（依 user id 錯開，避免大家收同一批）
    db.execute(
        text("""
INSERT INTO favorites (user_id, route_id, created_at)
WITH RECURSIVE k(n) AS (SELECT 0 UNION ALL SELECT n + 1 FROM k WHERE n < :per_user - 1),
pub AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY id) - 1 AS rn, COUNT(*) OVER () AS total
  FROM routes WHERE visibility = 'public' AND deleted_at IS NULL
)
SELECT u.id, pub.id, NOW(3) - INTERVAL (u.id + k.n * 37) MINUTE
FROM users u CROSS JOIN k JOIN pub ON pub.rn = (u.id * 7 + k.n) % pub.total
WHERE u.id <> :owner
"""),
        {"per_user": PUBLIC_FAVS_PER_USER, "owner": owner_id},
    )
    # 再加自己約 1/4 的私人路線
    db.execute(
        text("""
INSERT INTO favorites (user_id, route_id, created_at)
SELECT user_id, id, NOW(3) - INTERVAL id SECOND FROM routes
WHERE visibility = 'private' AND deleted_at IS NULL AND id % 4 = 0
""")
    )
    db.commit()
    # 讓優化器拿到正確的統計資料（索引基數），不然小表的計畫不準
    for table in ("users", "routes", "favorites"):
        db.execute(text(f"ANALYZE TABLE {table}")).all()


# ---------------------------------------------------------------- capture


@dataclass
class Captured:
    statement: str
    params: object


@contextmanager
def capture(engine: Engine):
    """攔下這段期間 ORM 送出的每一條 SQL（語句 + 參數，與 DB 收到的一致）。"""
    seen: list[Captured] = []

    def _listener(conn, cursor, statement, parameters, context, executemany):
        if not executemany:
            seen.append(Captured(statement, parameters))

    event.listen(engine, "before_cursor_execute", _listener)
    try:
        yield seen
    finally:
        event.remove(engine, "before_cursor_execute", _listener)


class _NoopStorage(GpxStorage):
    """delete_route 會刪 S3 檔；這裡只要它送出的 SQL。"""

    def __init__(self) -> None:  # noqa: D107 - 不需要 client
        pass

    def put(self, key: str, data: bytes) -> None:
        return None

    def delete(self, key: str) -> None:
        return None


# ---------------------------------------------------------------- scenarios


@dataclass
class Sample:
    """跑情境用的代表性資料：一位一般使用者、他的一條私人路線、一條公開路線。"""

    user: User
    private_id: str
    slug: str
    unfavorited_slug: str


@dataclass
class Case:
    title: str
    source: str  # 對應的 service 函式，寫進報告
    run: Callable[[Session, Sample], object]
    pick: Callable[[str], bool]  # 從攔到的 SQL 裡挑出要分析的那一條
    index: tuple[str, str]  # (table, index)：拿掉它當「之前」
    timed: bool = True  # DELETE 不重複執行計時
    note: str = ""
    results: dict = field(default_factory=dict)


def _sample(db: Session) -> Sample:
    users = db.scalar(select(func.count()).select_from(User)) or 0
    user = db.scalar(select(User).where(User.firebase_uid == f"explain-seed-{users // 2}"))
    private = db.scalar(
        select(Route.public_id)
        .where(Route.user_id == user.id, Route.visibility == "private", Route.deleted_at.is_(None))
        .limit(1)
    )
    fav_ids = {f.route_id for f in favorite_service.list_favorites(db, user)}
    slugs = list(
        db.scalars(
            select(Route.slug).where(
                Route.visibility == "public", Route.deleted_at.is_(None), Route.id.not_in(fav_ids)
            )
        )
    )
    return Sample(user=user, private_id=private, slug=slugs[0], unfavorited_slug=slugs[1])


def _is_select_from(table: str) -> Callable[[str], bool]:
    return lambda sql: sql.lstrip().upper().startswith("SELECT") and f"FROM {table}" in sql


CASES = [
    Case(
        "公開路線清單（探索頁、訪客 dashboard）",
        "public_route_service.list_public_routes",
        lambda db, s: public_route_service.list_public_routes(db),
        _is_select_from("routes"),
        ("routes", "idx_routes_public_list"),
    ),
    Case(
        "公開路線詳情／下載（以 slug 查）",
        "public_route_service.get_public_route",
        lambda db, s: public_route_service.get_public_route(db, s.slug),
        _is_select_from("routes"),
        ("routes", "uq_routes_slug"),
    ),
    Case(
        "我的路線清單（新上傳在前）",
        "route_service.list_routes",
        lambda db, s: route_service.list_routes(db, s.user),
        _is_select_from("routes"),
        ("routes", "idx_routes_user_list"),
    ),
    Case(
        "上傳配額計數",
        "route_service.count_routes",
        lambda db, s: route_service.count_routes(db, s.user),
        lambda sql: "count(" in sql.lower(),
        ("routes", "idx_routes_user_list"),
    ),
    Case(
        "我的收藏（新收藏在前，JOIN routes 過濾看得到的）",
        "favorite_service.list_favorites",
        lambda db, s: favorite_service.list_favorites(db, s.user),
        _is_select_from("favorites"),
        ("favorites", "idx_favorites_user_created"),
    ),
    Case(
        "加入收藏：找路線（slug 或 public_id）",
        "favorite_service.add_favorite → _find_route",
        lambda db, s: favorite_service.add_favorite(db, s.user, get_settings(), s.unfavorited_slug),
        _is_select_from("routes"),
        ("routes", "uq_routes_slug"),
    ),
    Case(
        "加入收藏：私人路線（public_id OR slug）",
        "favorite_service.add_favorite → _find_route",
        lambda db, s: favorite_service.add_favorite(db, s.user, get_settings(), s.private_id),
        _is_select_from("routes"),
        ("routes", "uq_routes_public_id"),
        note="id 是 ULID 時條件變成 slug = ? OR public_id = ?，兩個 UNIQUE 索引合併查。",
    ),
    Case(
        "加入收藏：收藏數上限檢查",
        "favorite_service.add_favorite",
        lambda db, s: favorite_service.add_favorite(db, s.user, get_settings(), s.unfavorited_slug),
        lambda sql: "count(" in sql.lower() and "favorites" in sql,
        ("favorites", "idx_favorites_user_created"),
        note="PK (user_id, route_id) 的前綴也能用，拿掉 idx_favorites_user_created 時會改走 PK。",
    ),
    Case(
        "刪除私人路線時清掉它的收藏",
        "route_service.delete_route",
        lambda db, s: route_service.delete_route(db, s.user, _NoopStorage(), s.private_id),
        lambda sql: sql.lstrip().lower().startswith("delete from favorites"),
        ("favorites", "idx_favorites_route"),
        timed=False,
    ),
]

# ---------------------------------------------------------------- explain

_HINT_TARGET = re.compile(r"\b(SELECT|DELETE)\b", re.IGNORECASE)


def without_index(sql: str, table: str, index: str) -> str:
    """在每個 SELECT／DELETE 後面插 NO_INDEX hint；不在該 query block 的表 MySQL 會略過。"""
    return _HINT_TARGET.sub(lambda m: f"{m.group(1)} /*+ NO_INDEX({table} {index}) */", sql)


def explain(db: Session, sql: str, params) -> list[dict]:
    cursor = db.connection().connection.cursor()
    try:
        cursor.execute("EXPLAIN " + sql, params)
        names = [c[0] for c in cursor.description]
        return [dict(zip(names, row, strict=True)) for row in cursor.fetchall()]
    finally:
        cursor.close()


def time_query(db: Session, sql: str, params, runs: int) -> float:
    """重複執行取中位數（毫秒）；只量 SELECT。"""
    cursor = db.connection().connection.cursor()
    samples = []
    try:
        for _ in range(runs):
            start = time.perf_counter()
            cursor.execute(sql, params)
            cursor.fetchall()
            samples.append((time.perf_counter() - start) * 1000)
    finally:
        cursor.close()
    return statistics.median(samples)


def literal_sql(db: Session, sql: str, params) -> str:
    """把參數代進去，報告裡可以直接複製到 mysql client 重跑。"""
    cursor = db.connection().connection.cursor()
    try:
        return cursor.mogrify(sql, params)
    finally:
        cursor.close()


def analyze(db: Session, case: Case, sample: Sample, runs: int) -> bool:
    engine = db.get_bind()
    with capture(engine) as seen:
        case.run(db, sample)
        db.flush()
    db.rollback()  # 情境裡的寫入（加收藏、刪路線）都不保留
    matches = [c for c in seen if case.pick(c.statement)]
    if not matches:
        raise RuntimeError(f"{case.title}：沒攔到預期的 SQL，攔到 {[c.statement for c in seen]}")
    target = matches[0]
    table, index = case.index
    before_sql = without_index(target.statement, table, index)
    case.results = {
        "sql": literal_sql(db, target.statement, target.params),
        "after": explain(db, target.statement, target.params),
        "before": explain(db, before_sql, target.params),
    }
    if case.timed:
        case.results["after_ms"] = time_query(db, target.statement, target.params, runs)
        case.results["before_ms"] = time_query(db, before_sql, target.params, runs)
    used = [row for row in case.results["after"] if row["table"] == table]
    # index_merge 時 key 是逗號分隔的多個索引
    return any(index in (row["key"] or "").split(",") for row in used)


# ---------------------------------------------------------------- report


def _plan_table(rows: list[dict]) -> list[str]:
    lines = ["| " + " | ".join(EXPLAIN_COLUMNS) + " |", "|" + "---|" * len(EXPLAIN_COLUMNS)]
    for row in rows:
        lines.append("| " + " | ".join(str(row.get(c) or "") for c in EXPLAIN_COLUMNS) + " |")
    return lines


def render(cases: list[Case], counts: dict[str, int], server: str, runs: int) -> str:
    out = [
        "# T7 EXPLAIN 報告",
        "",
        f"MySQL {server}；資料量："
        + "、".join(f"{t} {n:,} 筆" for t, n in counts.items())
        + f"。時間為重複 {runs} 次的中位數（毫秒）。",
        "",
        "| 查詢 | 索引 | 之前 type／rows | 之後 type／rows | 之前 ms | 之後 ms |",
        "|---|---|---|---|---|---|",
    ]
    for c in cases:
        table, index = c.index
        b = next(r for r in c.results["before"] if r["table"] == table)
        a = next(r for r in c.results["after"] if r["table"] == table)
        ms = (
            (f"{c.results['before_ms']:.2f}", f"{c.results['after_ms']:.2f}")
            if c.timed
            else ("—", "—")
        )
        out.append(
            f"| {c.title} | `{index}` | {b['type']}／{b['rows']} | {a['type']}／{a['rows']} "
            f"| {ms[0]} | {ms[1]} |"
        )
    for c in cases:
        table, index = c.index
        out += ["", f"## {c.title}", "", f"來源：`{c.source}`", "", "```sql", c.results["sql"]]
        out += ["```", "", f"之前（`NO_INDEX({table} {index})`）：", ""]
        out += _plan_table(c.results["before"])
        out += ["", "之後：", ""]
        out += _plan_table(c.results["after"])
        if c.note:
            out += ["", c.note]
    return "\n".join(out) + "\n"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="T7：灌假資料並對 API 查詢跑 EXPLAIN")
    parser.add_argument("--users", type=int, default=5000)
    parser.add_argument("--runs", type=int, default=30)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args(argv)

    engine = get_engine()
    if engine.dialect.name != "mysql":
        print("只能對 MySQL 跑（EXPLAIN 與 optimizer hint 是 MySQL 語法）", file=sys.stderr)
        return 2
    with get_sessionmaker()() as db:
        if db.scalar(text("SELECT COUNT(*) FROM users")):
            print("users 不是空的：這支腳本會灌大量假資料，只能在空的資料庫上跑", file=sys.stderr)
            return 2
        seed(db, args.users)
        counts = {
            t: db.scalar(text(f"SELECT COUNT(*) FROM {t}"))
            for t in ("users", "routes", "favorites")
        }
        server = db.scalar(text("SELECT VERSION()"))
        sample = _sample(db)
        failed = [c.title for c in CASES if not analyze(db, c, sample, args.runs)]

    report = render(CASES, counts, server, args.runs)
    if args.output:
        args.output.write_text(report, encoding="utf-8")
    print(report)
    if failed:
        print("沒用上預期索引：" + "、".join(failed), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
