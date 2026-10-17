# 部署到 AWS：EC2（Docker）+ RDS MySQL

> 本文件只描述步驟，repo 內沒有任何 IaC，也還沒有實際開過資源。區域以 `ap-northeast-1`（東京）為例，可換成其他區域。

## 架構

```
瀏覽器 ──HTTPS──> Vercel（Next.js）
                    │  （期中加 rewrites，/api/* 轉到後端，cookie 才會是同站）
                    ▼
              ALB（443，ACM 憑證）
                    │ 8000
                    ▼
        EC2（Docker：velorder-api 容器）
                    │ 3306（TLS）
                    ▼
            RDS for MySQL 8.4（private subnet）
```

- API 只開在 ALB 後面；EC2 與 RDS 都不直接對外。
- 沒有 ALB 的最低成本做法：EC2 上加一個 Caddy 容器自動申請憑證、對外開 443，其餘不變。`SESSION_COOKIE_SECURE` 一樣要是 `true`。

## 1. 網路與 Security Group

VPC 用預設或自建皆可，需要至少兩個 AZ 的 subnet（ALB 與 RDS subnet group 都要求兩個 AZ）。

| Security Group | Inbound | 來源 | 用途 |
| --- | --- | --- | --- |
| `sg-alb` | TCP 443 | `0.0.0.0/0` | 對外 HTTPS |
| `sg-alb` | TCP 80 | `0.0.0.0/0` | 只做 301 轉 443 |
| `sg-api` | TCP 8000 | `sg-alb` | ALB → API |
| `sg-api` | TCP 22 | 自己的 IP/32 | SSH（建議改用 SSM Session Manager，就不用開 22） |
| `sg-rds` | TCP 3306 | `sg-api` | API → RDS |

Outbound 都維持預設全開（API 需要連 Google 取 Firebase 公鑰、連 RDS）。

RDS 設 **Public access = No**，只靠 `sg-rds` 放行 `sg-api`。

## 2. RDS for MySQL

### Parameter group

建一個 `mysql8.4` family 的 parameter group（例如 `velorder-mysql84`），修改：

| 參數 | 值 | 原因 |
| --- | --- | --- |
| `time_zone` | `UTC` | 與應用端 naive UTC 一致；`CURRENT_TIMESTAMP` 才不會差 8 小時 |
| `character_set_server` | `utf8mb4` | |
| `collation_server` | `utf8mb4_0900_ai_ci` | 與 migration 一致 |
| `require_secure_transport` | `ON` | 強制 TLS（8.4 預設通常已是 ON，確認即可） |

應用程式連線時也會送 `SET time_zone = '+00:00'`（`app/core/db.py`），parameter group 是第二層保險，也讓手動用 mysql client 查詢時看到的時間一致。

### 建立 DB instance

- Engine：MySQL 8.4.x
- 規格：開發／demo 用 `db.t4g.micro`，Storage gp3 20 GB
- DB parameter group：上面建的 `velorder-mysql84`
- Initial database name：`velorder`
- Master 帳號：自訂，密碼放 Secrets Manager 或至少不要寫進 repo
- VPC security group：`sg-rds`；Public access：No
- Automated backups：保留 7 天

### 建立應用程式帳號

不要讓 API 用 master 帳號。從 EC2 上連進去建一個：

```bash
docker run --rm -it mysql:8.4 mysql \
  -h <rds-endpoint> -u <master-user> -p --ssl-mode=REQUIRED
```

```sql
CREATE USER 'velorder'@'%' IDENTIFIED BY '<強密碼>' REQUIRE SSL;
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, DROP, INDEX, REFERENCES
  ON velorder.* TO 'velorder'@'%';
SELECT @@global.time_zone, @@character_set_server;   -- 應為 UTC、utf8mb4
```

`CREATE`／`ALTER`／`DROP`／`INDEX`／`REFERENCES` 是給 Alembic migration 用的；之後若要拆成 migration 帳號與執行帳號，執行帳號只留 DML 權限。

## 3. EC2

- AMI：Amazon Linux 2023，`t4g.small`（ARM，映像要用 arm64 建）或 `t3.small`（x86）
- Security group：`sg-api`
- IAM role：至少 `AmazonSSMManagedInstanceCore`（用 SSM 登入）
- 放在 private subnet 時要有 NAT Gateway（需要對外連 Google、拉映像）；成本考量下放 public subnet 也可以，但 `sg-api` 只放行 `sg-alb`

安裝 Docker：

```bash
sudo dnf install -y docker git
sudo systemctl enable --now docker
sudo usermod -aG docker ec2-user   # 重新登入後生效
```

下載 RDS CA bundle（TLS 連線驗證用）：

```bash
sudo mkdir -p /opt/velorder
sudo curl -fsSL -o /opt/velorder/rds-global-bundle.pem \
  https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem
```

## 4. 環境變數

在 EC2 建 `/opt/velorder/api.env`（權限 600，不進 git）：

```bash
DATABASE_URL=mysql+pymysql://velorder:<密碼>@<rds-endpoint>:3306/velorder?charset=utf8mb4&ssl_ca=/certs/rds-global-bundle.pem
FIREBASE_PROJECT_ID=<Firebase 專案 ID>
SESSION_COOKIE_SECURE=true
SESSION_TTL_DAYS=7
```

| 變數 | 正式環境值 | 備註 |
| --- | --- | --- |
| `DATABASE_URL` | 見上 | `ssl_ca` 指向容器內掛載的 RDS CA；密碼含特殊字元要 URL encode |
| `FIREBASE_PROJECT_ID` | Firebase 專案 ID | 只驗 ID token，不需要服務帳號金鑰 |
| `SESSION_COOKIE_SECURE` | `true` | **必須**是 true，前面一定要有 HTTPS |
| `SESSION_TTL_DAYS` | `7` | |

```bash
sudo chmod 600 /opt/velorder/api.env
```

## 4.5 S3（使用者上傳的 GPX）

瀏覽器拿後端發的 presigned POST 直接傳到 S3，API 再讀回來解析；S3 key 為 `users/{user_id}/routes/{route_id}.gpx`。

### Bucket

- 區域與 EC2 相同（`S3_REGION`），名稱例如 `dawnline-gpx-<帳號後綴>`
- Block Public Access：四項全開
- Object Ownership：Bucket owner enforced（ACL 停用）
- Default encryption：SSE-S3
- Versioning：可不開（刪除路線時檔案就該消失）

### CORS（Bucket → Permissions → CORS）

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

Vercel preview 網域要測上傳時，把該網域加進 `AllowedOrigins`。

### IAM（掛在 EC2 的 instance role）

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"],
      "Resource": "arn:aws:s3:::<bucket>/users/*"
    },
    {
      "Effect": "Allow",
      "Action": "s3:ListBucket",
      "Resource": "arn:aws:s3:::<bucket>"
    }
  ]
}
```

- `s3:PutObject` 是給 presigned POST 用的（URL 以 role 的身分簽名）。
- `s3:ListBucket` 讓檔案不存在時 HEAD 回 404 而不是 403，API 才能回「找不到這次上傳」。
- 不需要 access key：boto3 會從 instance metadata 取得 role 的臨時憑證。

### 環境變數（加到 `/opt/velorder/api.env`）

```bash
S3_BUCKET=<bucket>
S3_REGION=<與 bucket 相同的區域，例如 ap-northeast-1>
GPX_MAX_BYTES=5242880          # 每檔 5 MB
GPX_MAX_ROUTES_PER_USER=10
```

### Vercel

- 加環境變數 `BACKEND_API_URL=https://api.<你的網域>`（不含結尾斜線），重新部署。
  `next.config.js` 會把 `/api/v1/*` 轉到後端，`rc_session` 因此是 Vercel 網域上的同站 cookie。
- 後端必須是 HTTPS（`SESSION_COOKIE_SECURE=true`）。

### 驗證

```bash
# EC2 上：role 能寫入 bucket
aws s3 cp /etc/hostname s3://<bucket>/users/0/routes/check.gpx && aws s3 rm s3://<bucket>/users/0/routes/check.gpx
```

登入網站後打開 `/routes/private`，上傳一個 GPX，列表出現距離與爬升即成功。

## 5. 建映像與啟動

最簡單的做法是在 EC2 上直接 build（之後可改成 GitHub Actions 推到 ECR）：

```bash
git clone https://github.com/muchuanhung/velorder_ai.git
cd velorder_ai/backend
docker build -t velorder-api:$(git rev-parse --short HEAD) -t velorder-api:latest .

docker run -d --name velorder-api --restart unless-stopped \
  --env-file /opt/velorder/api.env \
  -v /opt/velorder/rds-global-bundle.pem:/certs/rds-global-bundle.pem:ro \
  -p 8000:8000 \
  velorder-api:latest
```

容器的 CMD 會先跑 `alembic upgrade head`，成功才啟動 uvicorn；migration 失敗容器會直接退出，`docker logs velorder-api` 看原因。

## 6. Migration

- **一般情況**：啟動容器時自動執行 `alembic upgrade head`，不需要手動做。
- **單獨執行**（例如部署前先升級 schema，或確認版本）：

  ```bash
  docker run --rm --env-file /opt/velorder/api.env \
    -v /opt/velorder/rds-global-bundle.pem:/certs/rds-global-bundle.pem:ro \
    velorder-api:latest alembic upgrade head

  docker run --rm --env-file /opt/velorder/api.env \
    -v /opt/velorder/rds-global-bundle.pem:/certs/rds-global-bundle.pem:ro \
    velorder-api:latest alembic current
  ```

- **回退**：`alembic downgrade -1`。0001／0002 的 downgrade 會 DROP 表，正式環境回退前先做 RDS snapshot。
- 只跑一台 API 時自動 migration 沒問題；之後若擴成多台，改成部署流程裡先單獨跑一次 migration，再啟動 API，避免多台同時跑。

## 7. ALB

- Target group：HTTP、port 8000、target type instance，health check path `/health`，成功碼 `200`
- Listener 443：ACM 憑證（例如 `api.<你的網域>`），轉發到 target group
- Listener 80：301 轉 443
- Route 53（或其他 DNS）：`api.<你的網域>` ALIAS 到 ALB

uvicorn 已開 `--proxy-headers`，會讀 ALB 帶的 `X-Forwarded-Proto`。

## 8. 驗證

```bash
# EC2 上：容器健康狀態（Dockerfile 的 HEALTHCHECK 打 /health）
docker ps --format '{{.Names}} {{.Status}}'        # 應顯示 (healthy)
curl -s http://127.0.0.1:8000/health              # {"status":"ok","database":"ok"}

# 外部：經 ALB / HTTPS
curl -s https://api.<你的網域>/health
curl -s -o /dev/null -w '%{http_code}\n' https://api.<你的網域>/api/v1/me   # 401

# DB 端：確認 schema 與時區
docker run --rm -it mysql:8.4 mysql -h <rds-endpoint> -u velorder -p --ssl-mode=REQUIRED velorder \
  -e "SELECT * FROM alembic_version; SHOW TABLES; SELECT @@global.time_zone, NOW(), UTC_TIMESTAMP();"
# alembic_version 應為 0004；users、sessions、routes、segments、cctv 都在；NOW() 與 UTC_TIMESTAMP() 相同
```

完整登入流程（用真的 Firebase ID token）：

```bash
TOKEN=<從前端 firebase.auth().currentUser.getIdToken() 取得>
curl -s -c jar.txt -H 'Content-Type: application/json' \
  -d "{\"idToken\":\"$TOKEN\"}" https://api.<你的網域>/api/v1/auth/session   # 200 + 會員資料
curl -s -b jar.txt https://api.<你的網域>/api/v1/me                          # 200
curl -s -b jar.txt -c jar.txt -X DELETE -o /dev/null -w '%{http_code}\n' \
  https://api.<你的網域>/api/v1/auth/session                                  # 204
curl -s -b jar.txt -o /dev/null -w '%{http_code}\n' https://api.<你的網域>/api/v1/me   # 401
```

## 9. 更新版本

```bash
cd velorder_ai && git pull
cd backend && docker build -t velorder-api:$(git rev-parse --short HEAD) -t velorder-api:latest .
docker rm -f velorder-api
docker run -d --name velorder-api ...   # 同第 5 節
```

舊映像保留 tag，回滾時改用舊 tag 啟動即可（schema 有變動時要先評估是否需要 downgrade）。

## 注意事項

- 前端在 Vercel、API 在另一個網域時，`SameSite=Lax` 的 `rc_session` 不會隨跨站 fetch 送出，所以前端一律經 Vercel 的 `/api/v1/*` rewrite 呼叫後端（見 4.5 的 Vercel 段）。
- `.env`、`api.env`、RDS 密碼都不要進 git。
