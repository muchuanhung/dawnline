<img src="docs/images/dawnline-banner.png" alt="曉行 Dawnline：出發前，先看清每一段路" width="100%" />

# 曉行 Dawnline

[![CI](https://github.com/muchuanhung/Velorder_AI/actions/workflows/ci.yml/badge.svg)](https://github.com/muchuanhung/Velorder_AI/actions/workflows/ci.yml)

> 出發前判讀台灣單車、跑步與越野路線的天氣與路況風險。

曉行 Dawnline 沿 GPX 軌跡每 0.5 km 取樣反查行政區，依騎經各路段的預估時間（20 km/h）挑選 CWB 鄉鎮預報時段，再套上測站雨量與 TDX 路況事件，對每條路線給出「安全／注意／危險／未判定」的判讀；資料缺漏、預報過期或騎經時間超出預報時段時判為未判定，並標示原因，不宣稱安全。

（GitHub repo 沿用舊名 `Velorder_AI`，產品名稱為曉行 Dawnline。）

## 功能

| 頁面 | 說明 |
|------|------|
| `/` 首頁 | 未登入可看前 3 條路線的即時判定；已登入轉 `/dashboard` |
| `/dashboard` 今日判讀 | 各路線的判定、示警路段與 ETA 降雨時段；天氣卡片優先採用定位 3 km 內的測站雨量 |
| `/routes` 路線示警 | 路線列表與單一路線偵察：高度圖、依里程對應的行政區路段、沿線 CCTV；判定取自 `/api/routes/briefing`，與 Dashboard 同一份伺服器端判讀 |
| `/profile` | 個人資料與密碼設定 |
| `/routes/private` 私人路線 | 上傳私人 GPX 開發中，暫時隱藏（無入口，網址回 404） |
| `/lab/route-sim` | 3D 路線沙盤（實驗；正式環境需 `NEXT_PUBLIC_LAB_ENABLED=true`） |

## 技術架構

| 範疇 | 實際使用 |
|------|----------|
| 前端／API | Next.js 16（App Router、Route Handlers）、React 19、TypeScript、Tailwind CSS v4、Radix UI、three.js（`/lab`） |
| 認證 | Firebase Authentication（client 登入，server 以 Firebase Admin 驗證 `firebase-id-token` cookie） |
| 資料儲存 | Firestore（CCTV 清單）、Firebase Storage（`gpx/routes/*.gpx` 公開路線） |
| 背景工作 | Inngest（TDX CCTV 每日同步） |
| 外部資料 | CWB 開放資料（`F-D0047-*` 鄉鎮預報、`O-A0002-002` 測站雨量）、TDX（路況事件、CCTV） |
| 行政區反查 | 內建台灣鄉鎮 TopoJSON + bbox 索引，本地 point-in-polygon，不需外部地理服務 |
| 部署 | Vercel（見 `strava-route-system/vercel.json`） |
| 測試／CI | Playwright（unit 與 E2E project）、GitHub Actions 跑型別檢查與 unit 測試 |

## 專案結構

```
strava-route-system/          # pnpm + Turborepo monorepo
├── apps/web/                 # 曉行 Dawnline 主程式（Next.js）
│   ├── src/app/              # 頁面與 /api route handlers
│   ├── src/lib/              # cwb、tdx、routes、firebase 等邏輯
│   ├── src/inngest/          # Inngest functions
│   ├── tests/{unit,e2e}/     # Playwright 測試
│   └── docs/                 # TDX CCTV 等設定文件
├── apps/docs/                # create-next-app 範本，尚未使用
└── packages/
    ├── ui/                   # 共用元件
    ├── eslint-config/
    └── typescript-config/
```

## 背景工作（Inngest）

| Function | 觸發 | 內容 |
|----------|------|------|
| `tdx-cctv-sync` | Cron `0 4 * * *`（台灣 12:00） | 同步 TDX CCTV 清單到 Firestore；開發時也可 `POST /api/cctv/sync` 手動觸發 |

## 本機開發

需求：Node 22（見 `strava-route-system/.nvmrc`）、pnpm 9。

```bash
cd strava-route-system
pnpm install
pnpm --filter web dev                       # http://localhost:3000
npx inngest-cli@latest dev -u http://localhost:3000/api/inngest   # 另開終端，需要背景工作時
```

在 `strava-route-system/apps/web/.env.local` 設定環境變數（依需要的功能填寫）：

```bash
# Firebase（必填）
NEXT_PUBLIC_FIREBASE_API_KEY=
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=
NEXT_PUBLIC_FIREBASE_PROJECT_ID=
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=
NEXT_PUBLIC_FIREBASE_APP_ID=
FIREBASE_SERVICE_ACCOUNT_JSON=              # service account JSON 字串

# 天氣與路況（缺任一項時路線判讀為「未判定」；缺 TDX 時也沒有 CCTV）
CWB_API_KEY=
TDX_CLIENT_ID=
TDX_CLIENT_SECRET=

# 其他
NEXT_PUBLIC_APP_URL=http://localhost:3000
CCTV_SYNC_SECRET=                           # production 手動觸發 /api/cctv/sync 用
# 正式環境的 Inngest 另需 INNGEST_EVENT_KEY、INNGEST_SIGNING_KEY；本機 dev server 不需要
```

公開路線來自 Firebase Storage 的 `gpx/routes/*.gpx`，上傳後最多 10 分鐘生效（server 端快取）。

## 測試

```bash
cd strava-route-system/apps/web
pnpm test:unit    # 純函式，不需瀏覽器或 server，數秒內完成（CI 執行此項）
pnpm test:e2e     # 會先 next build 再於 3100 port 啟動；需 npx playwright install
```

Dashboard E2E 需要在 `.env.local` 設定 `E2E_USER_EMAIL`／`E2E_USER_PASSWORD`，未設定時自動跳過。

## 專案團隊

| 開發人員 | 負責範圍 |
|----------|----------|
| Muchuanhung | 全端開發 |
