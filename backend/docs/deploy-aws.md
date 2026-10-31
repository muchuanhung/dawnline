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
EC2 instance role ──> S3（GPX 讀寫刪、每日 DB 備份）、ECR（拉映像）

GitHub Actions ──OIDC──> IAM role dawnline-gha-deploy
   ├─ build 映像 → ECR dawnline-api:<commit SHA>
   ├─ SSM Run Command → EC2 執行 deploy.sh（換容器、健康檢查、失敗回滾）
   └─ 每 15 分鐘監控：/health、憑證、主機資源、備份新鮮度 → ALERT_WEBHOOK_URL
```

- **不用 ALB**：成本考量。TLS 由 Nginx 終止，憑證用 Let's Encrypt（免費、自動續期）。
- 8000、8001、3306 都不對外；對外只有 80、443（與 SSH）。
- Nginx 設定檔在 repo 的 [`backend/deploy/nginx.conf`](../deploy/nginx.conf)，主機上的位置是 `/etc/nginx/conf.d/dawnline-api.conf`。兩邊不一致時以主機為準，再把 repo 補回來。

## 1. EC2 與 Security Group

| 項目 | 設定 |
| --- | --- |
| 區域 | `ap-northeast-1`（東京） |
| OS | Ubuntu（SSH 帳號 `ubuntu`） |
| 規格 | 1 GB 記憶體級距，另加 1 GB swap（Nginx、留言板、API、MySQL 同機） |
| IP | Elastic IP；DNS `dawnline-api.message-board.bid` 的 A 記錄指向它 |
| IAM role | `dawnline-ec2-role`：`AmazonSSMManagedInstanceCore` + `AmazonEC2ContainerRegistryReadOnly` + inline policy `dawnline-gpx-s3`（見第 5 節） |
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

平常由 GitHub Actions 部署（第 8 節）：main 的 Backend CI 通過後自動 build、推 ECR，再經 SSM 在 EC2 執行 [`backend/deploy/deploy.sh`](../deploy/deploy.sh)。容器參數與下面相同。

Actions 或 ECR 不能用時的手動備援（在 EC2 上 build，1 GB 主機會吃 swap，較慢）：

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
- 回滾：Actions → Backend deploy → Run workflow，`image_tag` 填上一版 commit SHA（ECR 保留最近 10 版，主機保留最近 3 版）。
- 新映像不健康時 deploy.sh 會自動換回舊映像，但新映像已跑過的 migration 不會退回，所以 migration 要維持「只加不刪」，舊程式碼才能在新 schema 上跑。

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

腳本在 repo 的 [`backend/deploy/mysql-backup.sh`](../deploy/mysql-backup.sh)：mysqldump 失敗、gzip 壞掉或缺少 `-- Dump completed` 結尾都會中止，不會上傳半截檔案。安裝或更新（檔名不能有 `.sh`，run-parts 會跳過有點的檔名）：

```bash
cd ~/dawnline && git pull
sudo install -m 755 backend/deploy/mysql-backup.sh /etc/cron.daily/dawnline-mysql-backup
sudo /etc/cron.daily/dawnline-mysql-backup && journalctl -t dawnline-backup -n 1   # 立刻跑一次
```

- cron.daily 由 `/etc/crontab` 每天 06:25（主機時區，Ubuntu 預設 UTC）觸發。
- 監控每 15 分鐘檢查最新備份是否在 26 小時內、大於 1 KB；每週一把最新備份還原到 GitHub Actions 裡的暫時 MySQL，確認 `alembic_version` 與各表筆數（第 9 節）。

還原：

```bash
sudo docker run --rm amazon/aws-cli s3 cp s3://dawnline-gpx/backups/velorder-<日期>.sql.gz - --region ap-northeast-1 \
  | gunzip | sudo docker exec -i dawnline-mysql sh -c 'mysql -u velorder -p"$MYSQL_PASSWORD" velorder'
```

## 7a. 公開路線匯入（T6）

公開路線（原 Firebase Storage `gpx/routes/`）存在同一張 `routes` 表（`visibility='public'`），
GPX 放在匯入者的 `users/{id}/routes/` 底下，所以 §5 的 instance role 權限不用改。檔名（去掉 `.gpx`）就是前端的路線 id。
前端只讀後端，沒有 Firebase 備援：T6 合併、部署完成後要馬上匯入，否則公開路線頁是空的。匯入並確認正式站正常後，Firebase Storage 的 `gpx/routes/` 可以刪除。

1. 從 Firebase Console → Storage → `gpx/routes/` 下載全部 GPX，放到本機資料夾（例如 `public-gpx/`），檔名不要改。
2. 用要掛名的帳號在網站登入一次（`users` 才有這筆），到 Firebase Console → Authentication 抄下 UID。
3. EC2 Instance Connect 不能上傳檔案，先借 S3 中轉：AWS Console → S3 → `dawnline-gpx` → 上傳到 `users/import/public-gpx/`
   （GPX 直接放在這層，不要多一層資料夾；instance role 只能讀 `users/*`）。
4. 在 EC2 拉下來、放進 API 容器、匯入（先 `--dry-run` 看結果）：

```bash
mkdir -p ~/public-gpx
sudo docker run --rm -v ~/public-gpx:/out amazon/aws-cli s3 cp s3://dawnline-gpx/users/import/public-gpx/ /out --recursive --region ap-northeast-1
ls ~/public-gpx                                        # 要看到 .gpx 檔
sudo docker exec velorder-api rm -rf /tmp/public-gpx   # 目的地已存在時 docker cp 會多包一層
sudo docker cp ~/public-gpx velorder-api:/tmp/public-gpx
sudo docker exec velorder-api python -m app.scripts.import_public_routes /tmp/public-gpx --owner-uid <UID> --dry-run
sudo docker exec velorder-api python -m app.scripts.import_public_routes /tmp/public-gpx --owner-uid <UID>
curl -s https://dawnline-api.message-board.bid/api/v1/public-routes | head -c 400
```

5. 確認後刪掉 S3 的 `users/import/`。

輸出每行是 `created`／`updated`／`unchanged`＋slug；資料夾沒有 `.gpx`（副檔名不分大小寫，子資料夾不讀）時會報錯並結束，不會下架任何路線。之後新增或修改公開路線：把檔案放進同一個資料夾重跑即可；
加 `--prune` 會把資料夾裡沒有的公開路線下架（軟刪除、刪 S3 檔、清收藏）。
容器重建後 `/tmp/public-gpx` 會消失，資料已在 S3 與 MySQL，不影響服務。

## 7. Vercel

- 環境變數 `BACKEND_API_URL=https://dawnline-api.message-board.bid`（Production 與 Preview，不含結尾斜線）。
- rewrite 在 build 時讀這個變數，改了要 Redeploy 才生效。
- 前端一律經 Vercel 的 `/api/v1/*` 呼叫後端，不直接打 API 網域：`rc_session` 是 `SameSite=Lax`，跨站 fetch 不會帶上。

## 8. 自動部署：GitHub Actions + ECR + SSM

Workflow：[`.github/workflows/backend-deploy.yml`](../../.github/workflows/backend-deploy.yml)。GitHub 不存任何 AWS 長期金鑰，用 OIDC 換臨時憑證；EC2 不開新 port，也不需要 SSH，指令走 SSM。

以下在 AWS Console（東京區）做一次。`<ACCOUNT_ID>` 是右上角帳號 ID，`<INSTANCE_ID>` 是 EC2 的 `i-...`。

1. **確認 EC2 已接上 SSM**：Systems Manager → Fleet Manager，看得到這台且 Ping status 為 Online。看不到時在 EC2 上 `sudo snap services amazon-ssm-agent`，沒裝就 `sudo snap install amazon-ssm-agent --classic`。role 已有 `AmazonSSMManagedInstanceCore`。
2. **EC2 role 加 ECR 讀取**：IAM → Roles → `dawnline-ec2-role` → Add permissions → Attach `AmazonEC2ContainerRegistryReadOnly`。
3. **建 ECR repository**：ECR → Create repository，名稱 `dawnline-api`，Private，Tag immutability 關閉，加密 AES-256。建好後 Lifecycle policy → Create rule，填：Rule priority `1`、Image tag status **Any**、Match criteria **Image count**、Count `10`、Rule action **Expire**（只保留最新 10 版；設定內容同 [`backend/deploy/ecr-lifecycle.json`](../deploy/ecr-lifecycle.json)）。不要選 Days since image created，那會把超過天數的映像全部刪掉，連正在跑的那版也是。
4. **GitHub OIDC provider**：IAM → Identity providers → Add provider → OpenID Connect，URL `https://token.actions.githubusercontent.com`，Audience `sts.amazonaws.com`。
5. **部署用 role**：IAM → Roles → Create role → Custom trust policy，貼 [`backend/deploy/iam/gha-trust-policy.json`](../deploy/iam/gha-trust-policy.json)（換掉 `<ACCOUNT_ID>`），不加 managed policy，名稱 `dawnline-gha-deploy`。建好後 Add permissions → Create inline policy → JSON，貼 [`backend/deploy/iam/gha-deploy-policy.json`](../deploy/iam/gha-deploy-policy.json)（換掉 `<ACCOUNT_ID>`、`<INSTANCE_ID>`），名稱 `dawnline-gha-deploy`。
6. **GitHub 設定**（repo → Settings）：
   - Environments：用既有的 `Production`（Vercel 建的；GitHub 環境名稱不分大小寫，workflow 寫 `production` 就是它），沒有就 New environment。Deployment branches and tags 選 Selected branches and tags，只加 `main`。
   - 下面的 Variables 與 Secret 都建在 **Repository** 層級（不是 Environment），因為監控 job 不走 environment。
   - Secrets and variables → Actions → Variables：`AWS_DEPLOY_ROLE_ARN`＝`arn:aws:iam::<ACCOUNT_ID>:role/dawnline-gha-deploy`、`EC2_INSTANCE_ID`＝`<INSTANCE_ID>`；EC2 是 Graviton（`t4g`）時再加 `EC2_PLATFORM`＝`linux/arm64`（預設 `linux/amd64`）。
   - Secrets：`ALERT_WEBHOOK_URL`，與 Vercel 同一個值（Discord webhook 加 `/slack` 結尾）。
7. **第一次部署**：Actions → Backend deploy → Run workflow（`image_tag` 留空）。成功後 `sudo docker ps` 會看到 `velorder-api` 的映像變成 `<ACCOUNT_ID>.dkr.ecr...dawnline-api:<SHA>`；舊的本機 `velorder-api:latest` 保留作手動回滾。

流程：push main → Backend CI（pytest、ruff、MySQL 驗證）通過 → build（GHA cache）→ 推 `dawnline-api:<SHA>` → SSM 執行 deploy.sh（ECR 登入、pull、換容器、等 HEALTHCHECK healthy、清舊映像；不健康就換回舊映像並讓 workflow 失敗）→ 對外 HTTPS `/health` 煙霧測試。失敗會推一則告警。

## 9. 監控

Workflow：[`.github/workflows/backend-monitor.yml`](../../.github/workflows/backend-monitor.yml)，每 15 分鐘（公開 repo，Actions 分鐘數不計費；GitHub 排程尖峰時段可能延遲幾分鐘）。

| 檢查 | 失敗條件 |
| --- | --- |
| 對外 `/health` | 重試 3 次仍非 200 或 `database` 不是 ok |
| TLS 憑證 | 剩不到 14 天（代表 cron.weekly 續期壞了） |
| 主機（SSM 執行 [`host-check.sh`](../deploy/host-check.sh)） | 根目錄磁碟 ≥ 85%、可用記憶體＋swap < 100 MB、`velorder-api` 不是 healthy、`dawnline-mysql` 沒在跑、nginx 不是 active |
| 備份新鮮度 | `backups/` 最新物件超過 26 小時或 ≤ 1 KB |
| 還原測試（每週一） | 最新備份還原失敗，或 `users` 是空的 |

告警只在狀態改變時送出（正常→異常、異常→恢復），送到 `ALERT_WEBHOOK_URL`，格式與前端 `lib/observability/report.ts` 相同（`{ text }`）。手動檢查：Actions → Backend monitor → Run workflow。

- repo 超過 60 天沒有任何 commit，GitHub 會自動停用排程 workflow，要到 Actions 頁面重新啟用。
- 選配（免費）：EC2 → 這台 → Actions → Monitor and troubleshoot → Manage CloudWatch alarms，對 `StatusCheckFailed_System` 建 Recover 動作，硬體故障時 AWS 會自動搬到新主機（Elastic IP 不變）。

## 10. 驗證

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
- **Backend deploy 在 configure-aws-credentials 失敗（Not authorized to perform sts:AssumeRoleWithWebIdentity）**：trust policy 的 `sub` 與實際不符。GitHub 的 sub 帶帳號與 repo 的數字 ID：部署 job 是 `repo:muchuanhung@61078091/dawnline@1098354055:environment:production`，監控是 `...:ref:refs/heads/main`。實際值看 CloudTrail（東京）Event history → `AssumeRoleWithWebIdentity` → `userIdentity.userName`。
- **錯誤是 The web identity token provided could not be validated**：IAM Identity providers 裡沒有 `token.actions.githubusercontent.com`（第 8 節步驟 4）。
- **SSM 回 InvalidInstanceId**：Fleet Manager 看不到這台（agent 沒跑，或 role 缺 `AmazonSSMManagedInstanceCore`），或 `EC2_INSTANCE_ID` 填錯。
- **deploy.sh 在 ECR 登入失敗**：`dawnline-ec2-role` 沒掛 `AmazonEC2ContainerRegistryReadOnly`，或 metadata hop limit 不是 2。
- **映像在 EC2 上 `exec format error`**：EC2 是 arm64（Graviton），要設 `EC2_PLATFORM=linux/arm64`。
