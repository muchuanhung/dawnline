# 曉行 Routecast 後端（backend/）

FastAPI + SQLAlchemy 2 + Alembic + MySQL 8.4。登入用 Firebase ID token 換自有 session（HttpOnly cookie `rc_session`）。

```
app/
  core/      設定、DB、錯誤格式、Firebase 驗證、cookie
  models/    users、sessions、routes、segments、cctv
  schemas/   API 輸入輸出（camelCase）
  services/  auth_service（session）、route_service（GPX 上傳）、gpx（解析）、storage（S3）
  routers/   health、auth、me、routes
alembic/     0001 members、sessions；0002 routes；0003 segments、cctv；0004 members 改名 users；0005 routes 加 route_type（raw DDL，InnoDB／utf8mb4）
tests/       pytest，SQLite + 假 verifier，不連 MySQL、不連 Firebase
docs/        deploy-aws.md
```

## 端點

| 方法 | 路徑 | 說明 |
| --- | --- | --- |
| GET | `/health` | 含 `SELECT 1`；DB 連不上回 503 `db_unavailable` |
| POST | `/api/v1/auth/session` | body `{"idToken": "..."}`，驗證後設 `rc_session` cookie，回會員資料 |
| DELETE | `/api/v1/auth/session` | 登出，一律 204 並清 cookie |
| GET | `/api/v1/me` | 目前會員；沒登入回 401。每次通過驗證把 session 延長到「現在 + 7 天」 |
| POST | `/api/v1/routes/uploads` | body `{"fileSize": n}`，回 presigned POST（`uploadId`、`url`、`fields`）；超過配額 409、檔案太大 413 |
| POST | `/api/v1/routes` | body `{"uploadId", "name"?}`，檔案傳到 S3 後呼叫；解析 GPX 寫入 `routes`，壞檔 422 並刪檔 |
| GET | `/api/v1/routes` | 自己的路線列表與上限 `limit` |
| GET | `/api/v1/routes/{id}/gpx` | 回短效 presigned GET 網址 |
| DELETE | `/api/v1/routes/{id}` | 軟刪除並刪 S3 檔，釋出配額 |

routes 相關端點都要登入；別人的路線一律 404。S3 未設定（`S3_BUCKET` 空）時回 503 `storage_unavailable`。

錯誤一律是 `{"error": {"code": "...", "message": "..."}}`。

## 環境變數

見 `.env.example`。

| 變數 | 預設 | 說明 |
| --- | --- | --- |
| `DATABASE_URL` | `mysql+pymysql://velorder:velorder@localhost:3306/velorder?charset=utf8mb4` | SQLAlchemy 連線字串 |
| `FIREBASE_PROJECT_ID` | 空 | 驗 ID token 用；沒設時登入會失敗 |
| `SESSION_COOKIE_SECURE` | `true` | 本機 http 開發設 `false`，正式環境必須 `true` |
| `SESSION_TTL_DAYS` | `7` | session 有效天數 |
| `S3_BUCKET` | 空 | GPX bucket；EC2 上用 instance role，不設 access key |
| `S3_REGION` | `ap-northeast-1` | bucket 區域 |
| `GPX_MAX_BYTES` | `5242880` | 每檔上限 |
| `GPX_MAX_ROUTES_PER_USER` | `10` | 每人路線上限 |

## 本機用 Docker 跑（MySQL + API）

```bash
cd backend
FIREBASE_PROJECT_ID=<你的專案 ID> docker compose up --build -d
curl http://localhost:8000/health        # {"status":"ok","database":"ok"}
docker compose logs -f api
docker compose down -v                   # 連 MySQL 資料一起清掉
```

api 容器啟動時會先跑 `alembic upgrade head` 再起 uvicorn。MySQL 對外開 3306，帳密 `velorder` / `velorder`。

## 不用 Docker 跑 API

需要 Python 3.12+ 和一個 MySQL（可只起 compose 裡的 mysql：`docker compose up -d mysql`）。

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
cp .env.example .env                     # 填 FIREBASE_PROJECT_ID
alembic upgrade head
uvicorn app.main:app --reload --port 8000
```

API 文件：http://localhost:8000/docs

## 測試與檢查

```bash
cd backend
pip install -e ".[dev]"
pytest
ruff check .
ruff format --check .
```

pytest 用 SQLite 記憶體 DB，Firebase 驗證換成假的 verifier（`valid:<uid>` 視為合法 token）。`routes` 表有 MySQL 空間欄位，不在 SQLite 建，它的 migration 要在 MySQL 上驗：

```bash
docker compose up --build -d
docker compose exec mysql mysql -uvelorder -pvelorder velorder -e "SHOW CREATE TABLE routes\G"
docker compose exec api alembic downgrade base
docker compose exec api alembic upgrade head
```

## Migration

```bash
alembic upgrade head          # 升到最新
alembic downgrade -1          # 退一版
alembic current               # 目前版本
alembic revision -m "說明"    # 新增一支（本專案 migration 一律手寫 DDL）
```

## 部署

EC2（Docker）+ RDS MySQL，見 [docs/deploy-aws.md](docs/deploy-aws.md)。
