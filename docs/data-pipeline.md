# D5 資料管線（ETL／ELT）

> 依 main `b7f936d` 的程式碼整理。前端與排程在 `strava-route-system/apps/web`（Vercel），後端在 `backend/`（EC2）。

## 結論

曉行有五條資料管線。四條是**先轉換再存**（ETL）：外部資料很大、格式雜，判讀只需要其中幾個欄位，存小份比較快也比較省錢。只有 **GPX 路線**是**先存原始檔再轉換**（ELT）：原始 GPX 是使用者的資料，必須原封不動保留，轉換規則之後還會改。

所有管線共用同一條底線：**取不到、過期、格式不對的資料一律缺席，判讀改判 unknown，不當成「沒事」。**

| 管線 | 類型 | 來源 | 存放 | 頻率 |
|---|---|---|---|---|
| 1. 判讀輸入 | ETL | CWA 鄉鎮預報、雨量站、TDX 路況事件 | Firestore `briefing-inputs` | Inngest 每 10 分鐘 |
| 2. CCTV 鏡頭清單 | ETL | TDX 各縣市 CCTV | Firestore `cctv` | Inngest 每天 04:00 UTC |
| 3. 雷達與 1 小時降雨預報 | ETL（不落地） | CWA 公開 S3 | 伺服器記憶體＋CDN | 使用者開頁時，CWA 每 10 分鐘出一張 |
| 4. GPX 路線 | **ELT** | 使用者上傳／管理員上傳 | S3 原始檔＋MySQL 摘要 | 上傳時；解析結果公開 10 分鐘、私人 1 天快取 |
| 5. 資料庫備份 | EL | MySQL | S3 `backups/` | 每天 06:25 UTC |

```mermaid
flowchart LR
    subgraph 外部來源
        CWA[CWA 開放資料 API<br/>F-D0047 鄉鎮預報<br/>O-A0002-001 雨量站]
        TDX[TDX API<br/>路況事件、CCTV]
        CWAS3[CWA 公開 S3<br/>雷達回波、F-B0046-001]
        User[使用者／管理員<br/>GPX 檔]
    end
    subgraph Vercel
        Inngest[Inngest 排程]
        Brief[判讀 API<br/>briefing.ts 規則式判定]
        Radar[/api/radar]
    end
    subgraph 存放
        FS[(Firestore<br/>briefing-inputs、cctv)]
        S3[(S3 dawnline-gpx<br/>原始 GPX、DB 備份)]
        DB[(MySQL<br/>routes 摘要)]
    end
    CWA --> Inngest
    TDX --> Inngest
    Inngest -->|轉換後寫入| FS
    FS --> Brief
    CWAS3 --> Radar
    CWAS3 -->|降雨格點| Brief
    User -->|presigned POST| S3
    S3 -->|FastAPI 解析| DB
    S3 -->|下載後解析切段| Brief
    DB -->|mysqldump 每日| S3
```

---

## 1. 判讀輸入（ETL）

程式：`src/inngest/functions.ts`（`briefing-inputs-refresh`）→ `lib/dashboard/get-briefing.server.ts` 的 `loadBriefingInputs`，存放規則在 `lib/dashboard/briefing-inputs.ts`（純函式）。

| 階段 | 做什麼 |
|---|---|
| Extract | 對每條公開路線經過的行政區抓 CWA 鄉鎮預報 F-D0047；每個縣市抓 O-A0002-001 雨量站；每個縣市抓 TDX 即時路況事件 |
| Transform | 預報轉成判讀用的 `DistrictWeather`（3 小時時段的降雨機率、風速、天氣描述、是否過期 `stale`），比原始回應小很多；雨量站只留有效時雨量與座標；TDX 事件分類（施工、事故、封閉…）並保留座標，同一處多張「道路維護」許可在畫面上合併成一列標 ×N |
| Load | Firestore `briefing-inputs/{kind}:{key}`，欄位 `{ json, fetchedAt }`，例如 `weather:新北市|石碇區`、`rain:新北市`、`tdx:新北市` |

**為什麼要這條管線：** Vercel 的 Next 快取在多個執行個體之間不共用；TDX 限流很嚴（實測連續 6 次就 429）。改成排程統一抓、所有請求共用 Firestore 那一份，使用者開頁時不必再打 CWA／TDX。

**失敗處理：**

- 讀取時只採用 `fetchedAt` 在 **15 分鐘內**的輸入（`INPUT_MAX_AGE_MS`，排程 10 分鐘＋5 分鐘緩衝）；過期、缺少、JSON 壞掉都列入 `missing`，當場重抓。
- CWA 預報最晚時段距今不到 24 小時視為舊預報（`isForecastStale`），會跳過快取重抓一次；仍然舊就標 `stale`，判讀改判 unknown。
- **取不到的輸入不寫回**，避免把「沒有資料」存成「沒有事件」。
- TDX 縣市依序請求、間隔至少 500 ms，遇 429 等 5 秒重試一次，仍被限流就停止，其餘縣市標為取不到（該縣市路段判 unknown）。
- 告警：單一行政區失敗是常態不告警；整批失敗率過高（`reportFailureRate`）或 Inngest 重試用盡（`onFailure`）送 Discord。

## 2. CCTV 鏡頭清單（ETL）

程式：`src/inngest/functions.ts`（`tdx-cctv-sync`）→ `lib/tdx/client.ts` 抓取、`lib/background/tdx-cctv.firestore.ts` 轉換與寫入。

| 階段 | 做什麼 |
|---|---|
| Extract | 依序抓 TDX 各縣市 CCTV 清單，每縣市間隔 500 ms（約 2,000 支鏡頭） |
| Transform | 各縣市欄位名稱不一致（`VideoStreamURL`／`VideoUrl`／`Link.Url`…），統一成 `CCTVFirestoreDoc`；沒有座標或 id 的丟掉；算 7 碼 geohash |
| Load | Firestore `cctv/{cctvId}`，每 500 筆一批 `merge` 寫入 |

**讀取端：** 整份清單只讀 8 個欄位、快取 1 小時（清單一天才變一次，每讀一次全部都算 Firestore 讀取數），再依路線 bbox 外擴約 500 m 篩選，依緯度分 5 層取樣避免全擠在同一區。

**失敗處理：** 重試用盡會送 Discord；失敗時畫面沿用前一天的清單，不會報錯。已知缺口：TDX 對花蓮、苗栗、嘉義縣、澎湖、連江回 400，這幾個縣市目前沒有鏡頭。

> MySQL 裡有預留的 `cctv` 表（見 [D1](erd.md)），目前沒有使用。

## 3. 雷達回波與 1 小時降雨預報（ETL，不落地）

程式：`lib/cwb/radar.server.ts`（下載與快取）、`lib/cwb/radar.ts`（純函式：解析格點、裁切、上色）、`/api/radar`、`/api/radar/frame`。

| 階段 | 做什麼 |
|---|---|
| Extract | 從 CWA 公開 S3（`cwaopendata`，東京，不需要金鑰）列出最近 1 小時的合成回波歷史檔，下載最新的 F-B0046-001（未來 1 小時定量降雨預報） |
| Transform | 每筆 XML 約 9 MB，解析成格點後只裁路線周圍、畫成透明 PNG；降雨預報同時保留格點（`Float32Array`）給判讀用 |
| Load | 不存資料庫。PNG 依時間戳快取在伺服器記憶體（最多 14 張）與 CDN，同一張圖內容不會再變 |

**用途分開：** 雷達回波只給人看；判讀只用 F-B0046 格點判斷沿線雨勢大小（T10：降雨機率高但沿線 1 小時雨量 < 2.6 mm 時，危險降為注意）。

**失敗處理：** 判讀等降雨預報最多 5 秒，取不到就只看降雨機率（不會因此判成安全）。F-B0046 的 −99 同時代表「沒下雨」與「無效值」，無法區分，所以只用來**降級**、從不用來升成安全。

## 4. GPX 路線（ELT）

程式：後端 `backend/app/services/route_service.py`、`public_route_service.py`、`gpx.py`；前端 `lib/routes/parse-gpx.ts`、`geocode-districts.ts`、`load-routes.server.ts`。

| 階段 | 做什麼 |
|---|---|
| Extract | 前端向 FastAPI 要 presigned POST，瀏覽器**直接上傳到 S3**（不經過 Vercel 與 EC2，5 分鐘有效、限檔案大小） |
| Load | 原始 GPX 原封不動存在 S3 `users/{user_id}/routes/{public_id}.gpx`（key 由後端推得，前端無法指定）；公開路線掛在匯入者帳號下，路徑規則相同 |
| Transform（後端） | `complete_upload` 從 S3 讀檔，用 defusedxml 解析（擋 XXE），算距離、爬升、bbox、路線類型與 SHA-256，成功才 insert `routes`（`status = ready`），解析失敗就刪檔 |
| Transform（前端） | 判讀時下載 GPX，沿軌跡每 0.5 km 取樣，用內建 TopoJSON 做 point-in-polygon 反查鄉鎮，連續同區合併成一段；公開路線結果快取 10 分鐘，私人路線 1 天（檔案不會變，改名不影響軌跡） |

**為什麼是 ELT：**

1. 原始 GPX 是使用者的資料，要能原樣下載回去。
2. 轉換規則一直在改（切段方式從逐公里改成 0.5 km 取樣、T1 的爬升修正），保留原檔就能用新規則重算，不必請使用者重傳；快取鍵帶版本（`segments-v2`），規則一改就自動重算。
3. MySQL 只存清單頁需要的摘要（距離、爬升、bbox），逐點軌跡不進資料庫。

**失敗處理：** 先寫 S3 再寫 DB，DB 失敗頂多留一個沒人指到的檔案。後端讀不到時公開路線回空清單（畫面顯示空狀態），失敗不進快取，下次會重試。

## 5. 資料庫備份（EL）

程式：`backend/deploy/mysql-backup.sh`，裝在 EC2 的 `/etc/cron.daily/`。

- `mysqldump --single-transaction` → gzip → 上傳 `s3://dawnline-gpx/backups/velorder-YYYY-MM-DD.sql.gz`，S3 lifecycle 30 天後刪除。
- 上傳前檢查 gzip 完整、最後一行是 `-- Dump completed`，任何一步失敗都中止，不會上傳半截檔案。
- `backend-monitor.yml`：最新備份超過 26 小時或小於 1 KB 就轉紅；每週自動把最新備份還原到暫時的 MySQL 驗證一次。

## 為什麼這樣分工

| 決定 | 理由 |
|---|---|
| 天氣、路況存 Firestore，不存 MySQL | 管線跑在 Vercel，Firestore 與 Vercel 都是無伺服器，不必多開一條連到 EC2 的路；資料只活 15 分鐘，不需要關聯查詢 |
| 雷達不落地 | 每 10 分鐘一張、單張 9 MB，存下來沒有用途；圖依時間戳永遠不變，交給 CDN 快取最省 |
| 使用者資料（路線、收藏、排序）存 MySQL | 需要權限、配額、外鍵與交易，見 [D1](erd.md) |
| 判讀不存結果，每次即時算 | 輸入已經快取，判讀是純函式（`briefing.ts`），幾毫秒就算完；存結果反而會遇到「結果比輸入舊」的問題 |
