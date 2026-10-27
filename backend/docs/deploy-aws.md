# 部署到 AWS：單台 EC2（Nginx + Docker：API + MySQL）

> **現況（2026-10-27）**：已上線。API 在 `https://dawnline-api.message-board.bid`，跑在東京區（`ap-northeast-1`）一台 EC2 上，與留言板共用同一台機器與 Nginx。2026-10-17 起經 Vercel rewrite 對外服務（GPX 上傳 PR #56），2026-10-19 起資料庫從 RDS 改成同機的 MySQL 容器，RDS 已刪除。repo 內沒有 IaC，以下是實際設定的紀錄與重建步驟。

## 架構

```
瀏覽器 ──HTTPS──> Vercel（Next.js，dawnline-tw.vercel.app）
                    │  next.config.js rewrites：/api/v1/* → BACKEND_API_URL
                    │  （rc_session 因此是 Vercel 網域上的同站 cookie）
                    ▼ HTTPS
   EC2（Ubuntu，ap-northeast-1，Elastic IP）
   ├─ Nginx :80  → 只處理 Let's Encrypt 驗證，其餘 301 轉 443
   ├─ Nginx :443 → dawnline-api.message-board.bid ──> 127.0.0.1:8001
   │                 └─ velorder-api 容器（uvicorn :8000，--proxy-headers）
   │                       │ docker network "dawnline"
   │                       ▼
   │                 dawnline-mysql 容器（MySQL 8.4，不對外開 port）
   └─ Nginx :443 → message-board.bid ──> 127.0.0.1:8000（留言板，不屬於本 repo）

瀏覽器 ──HTTPS（presigned POST / GET）──> S3 dawnline-gpx（私有）
EC2 instance role ──> S3（GPX 讀寫刪、每日 DB 備份）
```

- **不用 ALB**：成本考量。TLS 由 Nginx 終止，憑證用 Let's Encrypt（免費、自動續期）。
- 8000、8001、3306 都不對外；對外只有 80、443（與 SSH）。
- Nginx 設定檔在 repo 的 [`backend/deploy/nginx.conf`](../deploy/nginx.conf)，主機上的位置是 `/etc/nginx/conf.d/dawnline-api.conf`。兩邊不一致時以主機為準，再把 repo 補回來。

## 1. EC2 與 Security Group

| 項目 | 設定 |
| --- | --- |
| 區域 | `ap-northeast-1`（東京） |
| OS | Ubuntu（SSH 帳號 `ubuntu`） |
| 規格 | 1 GB 記憶體級距，另加 2 GB swap（Nginx、留言板、API、MySQL 同機） |
| IP | Elastic IP；DNS `dawnline-api.message-board.bid` 的 A 記錄指向它 |
| IAM role | `dawnline-ec2-role`：`AmazonSSMManagedInstanceCore` + inline policy `dawnline-gpx-s3`（見第 5 節） |
| Metadata | hop limit **2**（容器內才拿得到 role 憑證） |

Security Group inbound：

| Port | 來源 | 用途 |
| --- | --- | --- |
| TCP 80 | `0.0.0.0/0` | Let's Encrypt HTTP-01 驗證、301 轉 443 |
| TCP 443 | `0.0.0.0/0` | HTTPS（API 與留言板） |
| TCP 22 | 自己的 IP/32 | SSH（可改用 SSM Session Manager 後關掉） |

**8000、8001、3306 不要加進 Security Group。** 80 必須對外開，否則憑證無法續期。

## 2. MySQL 容器

```bash
sudo docker network create dawnline

sudo mkdir -p /opt/velorder/mysql
sudo tee /opt/velorder/mysql/low-mem.cnf >/dev/null <<'EOF'
[mysqld]
character-set-server=utf8mb4
collation-server=utf8mb4_0900_ai_ci
default-time-zone=+00:00
innodb_buffer_pool_size=128M
performance_schema=OFF
max_connections=30
EOF

# /opt/velorder/mysql.env（chmod 600，不進 git）
#   MYSQL_ROOT_PASSWORD=...  MYSQL_DATABASE=velorder  MYSQL_USER=velorder  MYSQL_PASSWORD=...

sudo docker run -d --name dawnline-mysql --restart unless-stopped \
  --network dawnline \
  --env-file /opt/velorder/mysql.env \
  -v dawnline-mysql-data:/var/lib/mysql \
  -v /opt/velorder/mysql/low-mem.cnf:/etc/mysql/conf.d/low-mem.cnf:ro \
  mysql:8.4
```

- 前三行設定與 `backend/docker-compose.yml` 本機開發一致；`time_zone` 為 UTC，與應用端 naive UTC 一致（`app/core/db.py` 連線時也會送 `SET time_zone = '+00:00'`）。
- 不加 `-p`：3306 只在 `dawnline` network 內可見。
- 資料在 named volume `dawnline-mysql-data`，重建容器資料仍在。

## 3. API 容器

`/opt/velorder/api.env`（chmod 600，不進 git）：

| 變數 | 正式環境值 | 備註 |
| --- | --- | --- |
| `DATABASE_URL` | `mysql+pymysql://velorder:<密碼>@dawnline-mysql:3306/velorder?charset=utf8mb4` | 主機寫容器名稱，不能寫 `127.0.0.1` |
| `FIREBASE_PROJECT_ID` | Firebase 專案 ID | 只驗 ID token，不需要服務帳號金鑰 |
| `SESSION_COOKIE_SECURE` | `true` | **必須**是 true，前面一定要有 HTTPS（第 4 節） |
| `SESSION_TTL_DAYS` | `7` | |
| `S3_BUCKET` | `dawnline-gpx` | |
| `S3_REGION` | `ap-northeast-1` | |
| `GPX_MAX_BYTES` | `5242880` | 每檔 5 MB |
| `GPX_MAX_ROUTES_PER_USER` | `10` | |

不要放 `AWS_ACCESS_KEY_ID`：有的話 boto3 會改用那把 key，不走 instance role。

建映像與啟動（在 EC2 上 build；T5 會改成 GitHub Actions 推 ECR）：

```bash
cd ~/dawnline && git pull
cd backend && sudo docker build -t velorder-api:$(git rev-parse --short HEAD) -t velorder-api:latest .

sudo docker rm -f velorder-api
sudo docker run -d --name velorder-api --restart unless-stopped \
  --network dawnline \
  -p 127.0.0.1:8001:8000 \
  --env-file /opt/velorder/api.env \
  velorder-api:latest

curl -s http://127.0.0.1:8001/health   # {"status":"ok","database":"ok"}
```

- 只綁 `127.0.0.1:8001`，外部只能經 Nginx 進來。
- 容器 CMD 先跑 `alembic upgrade head`，成功才啟動 uvicorn；失敗容器直接退出，`sudo docker logs velorder-api` 看原因。
- 舊映像保留 commit tag，回滾時改用舊 tag 啟動（schema 有變動時先評估 downgrade）。

## 4. Nginx 與 HTTPS（Let's Encrypt）

### 第一次申請憑證

憑證還不存在時，`nginx -t` 會因為找不到 `fullchain.pem` 失敗，所以先只放 80 的 server 區塊（[`nginx.conf`](../deploy/nginx.conf) 的第一段），申請完再放完整檔案：

```bash
sudo mkdir -p /var/www/certbot
# 先放只有 port 80 server 區塊的版本，reload 後：
sudo docker run --rm \
  -v /etc/letsencrypt:/etc/letsencrypt \
  -v /var/www/certbot:/var/www/certbot \
  certbot/certbot certonly --webroot -w /var/www/certbot \
  -d dawnline-api.message-board.bid \
  --email <聯絡信箱> --agree-tos --no-eff-email -n

sudo cp ~/dawnline/backend/deploy/nginx.conf /etc/nginx/conf.d/dawnline-api.conf
sudo nginx -t && sudo systemctl reload nginx
```

### 自動續期

Let's Encrypt 憑證 90 天到期；certbot 只會在剩不到 30 天時真的續期，所以每週跑一次即可：

```bash
sudo tee /etc/cron.weekly/dawnline-certbot >/dev/null <<'EOF'
#!/bin/sh
docker run --rm -v /etc/letsencrypt:/etc/letsencrypt -v /var/www/certbot:/var/www/certbot \
  certbot/certbot renew --webroot -w /var/www/certbot -q && systemctl reload nginx
EOF
sudo chmod +x /etc/cron.weekly/dawnline-certbot

# 不真的續期，只確認流程可行
sudo docker run --rm -v /etc/letsencrypt:/etc/letsencrypt -v /var/www/certbot:/var/www/certbot \
  certbot/certbot renew --webroot -w /var/www/certbot --dry-run
```

### 為什麼 HTTPS 是必要條件

- `rc_session` 設了 `Secure`（`SESSION_COOKIE_SECURE=true`），只在 HTTPS 下送出。
- Vercel rewrite 打的是 `https://` 的 `BACKEND_API_URL`；uvicorn 開 `--proxy-headers`，靠 Nginx 送的 `X-Forwarded-Proto: https` 知道原始請求是 HTTPS。
- S3 presigned URL 一律是 HTTPS，頁面也是 HTTPS，不會有混合內容問題。
- 443 回應帶 `Strict-Transport-Security`，瀏覽器之後不會再走 HTTP。

## 5. S3 與 IAM

Bucket `dawnline-gpx`（`ap-northeast-1`）：Block Public Access 四項全開、ACL 停用（Bucket owner enforced）、SSE-S3。物件 key：

- `users/{user_id}/routes/{route_id}.gpx`：使用者上傳的 GPX
- `backups/velorder-YYYY-MM-DD.sql.gz`：每日 DB 備份，lifecycle rule `expire-backups` 30 天後刪除

CORS：

```json
[
  {
    "AllowedOrigins": ["https://dawnline-tw.vercel.app", "http://localhost:3000"],
    "AllowedMethods": ["POST", "GET"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3000
  }
]
```

要在 Vercel preview 網域測上傳時，把該網域加進 `AllowedOrigins`。

`dawnline-ec2-role` 的 inline policy `dawnline-gpx-s3`：

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"],
      "Resource": "arn:aws:s3:::dawnline-gpx/users/*"
    },
    {
      "Effect": "Allow",
      "Action": "s3:ListBucket",
      "Resource": "arn:aws:s3:::dawnline-gpx"
    },
    {
      "Effect": "Allow",
      "Action": "s3:PutObject",
      "Resource": "arn:aws:s3:::dawnline-gpx/backups/*"
    }
  ]
}
```

- `s3:PutObject` 給 presigned POST 用（URL 以 role 的身分簽名）。
- `s3:ListBucket` 讓檔案不存在時 HEAD 回 404 而不是 403，API 才能回「找不到這次上傳」。

## 6. 每日 DB 備份

```bash
sudo tee /etc/cron.daily/dawnline-mysql-backup >/dev/null <<'EOF'
#!/bin/sh
set -e
docker exec dawnline-mysql sh -c 'mysqldump -u velorder -p"$MYSQL_PASSWORD" --single-transaction --no-tablespaces velorder' \
  | gzip \
  | docker run --rm -i amazon/aws-cli s3 cp - "s3://dawnline-gpx/backups/velorder-$(date +%F).sql.gz" --region ap-northeast-1
EOF
sudo chmod +x /etc/cron.daily/dawnline-mysql-backup
```

還原：

```bash
sudo docker run --rm amazon/aws-cli s3 cp s3://dawnline-gpx/backups/velorder-<日期>.sql.gz - --region ap-northeast-1 \
  | gunzip | sudo docker exec -i dawnline-mysql sh -c 'mysql -u velorder -p"$MYSQL_PASSWORD" velorder'
```

## 7. Vercel

- 環境變數 `BACKEND_API_URL=https://dawnline-api.message-board.bid`（Production 與 Preview，不含結尾斜線）。
- rewrite 在 build 時讀這個變數，改了要 Redeploy 才生效。
- 前端一律經 Vercel 的 `/api/v1/*` 呼叫後端，不直接打 API 網域：`rc_session` 是 `SameSite=Lax`，跨站 fetch 不會帶上。

## 8. 驗證

自己的電腦（`/health` 只接受 GET，`curl -I` 送 HEAD 會得到 405，所以用 `-si`）：

```bash
curl -si https://dawnline-api.message-board.bid/health | head -12                            # HTTP/2 200，帶 strict-transport-security
curl -s https://dawnline-api.message-board.bid/health                                        # {"status":"ok","database":"ok"}
curl -sI http://dawnline-api.message-board.bid/health | head -1                              # 301
curl -s -o /dev/null -w '%{http_code}\n' https://dawnline-api.message-board.bid/api/v1/me    # 401（沒登入）
echo | openssl s_client -connect dawnline-api.message-board.bid:443 \
  -servername dawnline-api.message-board.bid 2>/dev/null | openssl x509 -noout -issuer -enddate   # Let's Encrypt、到期日
```

EC2 上：

```bash
sudo docker ps --format '{{.Names}} {{.Status}}'   # velorder-api (healthy)、dawnline-mysql Up
sudo nginx -t
free -m
```

線上網站（`https://dawnline-tw.vercel.app`）：登入 →「我的路線」→ 上傳 GPX → 清單出現距離與爬升 → 下載 → 刪除；刪除後 S3 `dawnline-gpx/users/...` 裡的檔案應該不見。

## 常見問題

- **certbot 失敗，提到 unauthorized 或 connection**：DNS 沒指到 Elastic IP，或 Security Group 沒對外開 80。
- **`nginx -t` 說找不到 fullchain.pem**：憑證還沒申請成功就放了 443 的區塊，照第 4 節先只放 80。
- **502 Bad Gateway**：`velorder-api` 沒起來，`curl http://127.0.0.1:8001/health` 與 `sudo docker logs --tail 50 velorder-api`。
- **登入後立刻被登出**：`SESSION_COOKIE_SECURE=true` 但請求不是 HTTPS，或 `BACKEND_API_URL` 寫成 `http://`。
- **上傳時 CORS 錯誤**：S3 CORS 的 `AllowedOrigins` 沒有目前的網址。
- **上傳回 500，log 有 NoCredentialsError**：metadata hop limit 還是 1，或 `api.env` 放了 access key。
- **`/api/v1/...` 回 404**：Vercel 沒設 `BACKEND_API_URL`，或設了沒重新部署。
