# D7 標準訓練以外的技術重點

> 依 main `b7f936d` 的程式碼整理。主推一項（離線 PWA 與「安全會過期」），備一項（地理運算），最後列其他可以提的點。

## 主推：離線 PWA 與「安全會過期」

### 要解決的問題

騎車上山時常收不到訊號。路況判讀如果在離線時顯示一片空白，使用者在最需要的時候什麼都看不到；但如果直接顯示上一次的「安全」，又可能是一小時前的資料，雨早就下了。一般 CRUD 專案只要處理「有網路／沒網路」，這裡多了一層：**快取資料本身會變得不可信**。

### 做法

**1. Service Worker 依資源類型用不同快取策略**（`public/sw.js`）

| 資源 | 策略 | 理由 |
|---|---|---|
| `/_next/static/*` | cache-first，最多 300 筆 | 檔名含 hash，內容永遠不會變 |
| 首頁、登入頁、圖示 | 安裝時預快取，平常走網路，離線才回快取 | 離線也打得開 App 外殼 |
| `/routes` 頁、路線 GPX、沿線鏡頭、判讀 API | **network-first**，成功才寫入快照，最多 40 筆 | 有網路一定拿最新的；失敗才退回快照 |
| 私人路線頁與它用的 API | network-first，但存在**獨立的** `dawnline-private-v1` | 登出時整個 cache 刪掉，換人登入看不到上一位的路線 |

細節：

- 寫入快照時在回應加上 `x-dawnline-snapshot-at`（存檔時間）。原回應的 header 不能改，所以複製 body 重建 `Response`。
- 判讀的快取鍵**去掉 `from` 參數**：途中模式每 0.5 km 就換一次 `from`，不去掉會把 40 筆額度塞滿同一條路線。
- 錯誤回應不寫入，避免一次 500 蓋掉可用的舊快照。
- 先刪再寫，讓剛看過的路線排在最後，裁切時刪的是最久沒看的。
- 只快取看過的路線，不主動下載，不吃使用者流量。

**2. 「安全」會過期，「危險」不會**（`src/lib/routes/snapshot.ts`，純函式）

判讀超過 30 分鐘（`SNAPSHOT_MAX_AGE_MS`）時：

| 原判定 | 過期後 | 理由 |
|---|---|---|
| 安全 | **改為未判定**，顯示「離線資料過期，無法確認安全」 | 「30 分鐘前沒有示警」不等於「現在沒事」 |
| 注意、危險 | 保留等級，加註「離線資料可能已變化」 | 已知的危險比什麼都不顯示有用；危險變安全的代價遠小於安全變危險 |
| 未判定 | 不變，補上過期原因 | — |

這條規則同時套在兩種情境，用 `offline` 參數區分文案：

- **離線快照**：SW 回的快照，從 `x-dawnline-snapshot-at` 算年齡。
- **線上但太久沒更新**：頁面開著放在口袋、從背景切回來。`useRouteBriefing` 每 30 秒重算一次年齡，`visibilitychange` 回前景時立刻重抓；重抓期間保留畫面上的判讀，但照樣套過期規則。

**3. 登出時清掉私人資料**（`src/contexts/AuthContext.tsx`）

登出時 `caches.delete("dawnline-private-v1")`。名稱在 `sw.js` 與 `snapshot.ts` 各寫一次，兩邊有註解互相提醒必須一致。

### 為什麼這不是標準訓練會碰到的

- 一般快取只問「新不新」，這裡要問「**這份資料過期後還能說什麼**」，而且答案依判定等級不同。
- 是產品鐵律「未判定 ≠ 安全」在離線情境的延伸：資料缺失、過期、超出預報時段一律回 unknown。
- 規則寫成純函式並有單元測試（`tests/unit/snapshot.spec.ts`），之後可以 1:1 移植到 Python。

### Demo 建議

1. 打開一條路線，等判讀出現「安全」。
2. DevTools → Network 切成 Offline，重新整理：畫面照樣出來，標示「N 分鐘前」。
3. DevTools → Application → Cache Storage 把快照的 `x-dawnline-snapshot-at` 改成 31 分鐘前（或直接等），重新整理：「安全」變成「離線資料過期，無法確認安全」，危險路段仍保留。

---

## 備選：地理運算（不靠付費地圖 API）

全部是前端純函式，沒有呼叫 Google Maps 等外部服務：

| 功能 | 程式 | 做法 |
|---|---|---|
| 路線經過哪些鄉鎮 | `lib/routes/geocode-districts.ts`、`lib/maps/taiwan-towns-topojson.ts` | 內建台灣鄉鎮 TopoJSON，沿軌跡每 0.5 km 取樣做 point-in-polygon（鄉鎮最窄處約 1 km，0.5 km 才不會漏掉短暫穿越的區），連續同區合併成一段 |
| 鏡頭、路況事件在路線第幾公里 | `lib/routes/recon-geo.ts` 的 `mapLatLonToKm` | 對 polyline **每一段**做垂足投影，取距離最小的；只看附近窗口在路線後段彎回來時會投錯里程 |
| 「你」在路線上的位置 | `recon-geo.ts` 的 `locateOnRoute` | GPS 精度超過 200 m 不換算，離路線超過 300 m 視為不在路線上；畫面顯示里程範圍而不是假精確的一個點 |
| 階梯狀海拔修正 | `lib/routes/elevation.ts` | 有些 GPX 只在海拔變化時才更新 `<ele>`，直接算坡度會出現 30% 以上的假陡坡；把連續等值的一段取中點當錨點，錨點之間線性內插 |
| 鏡頭清單地理索引 | `lib/geo/geohash.ts` | 同步時算 7 碼 geohash；目前讀取端用 bbox 篩選，geohash 留給資料量變大時的範圍查詢 |
| 雷達格點裁切 | `lib/cwb/radar.ts` | 9 MB 的全台格點只裁路線周圍、上色成透明 PNG，沿線 1 小時降雨量也從同一份格點取 |

---

## 其他可以提的點

- **無金鑰部署**：GitHub Actions 用 OIDC 換 AWS 暫時憑證，推映像到 ECR，再用 SSM Run Command 在 EC2 上換容器，**不開 SSH、repo 沒有任何 AWS 金鑰**；部署後打 `/health`，失敗自動換回舊容器（`backend/deploy/deploy.sh`、`.github/workflows/backend-deploy.yml`）。
- **備份會被驗證**：每日 mysqldump 上傳 S3，monitor 每天檢查備份新鮮度，每週把最新備份還原到暫時的 MySQL 跑一次（`backend-monitor.yml`）。沒有還原過的備份等於沒有備份。
- **排程與失敗告警**：Inngest 每 10 分鐘更新判讀輸入，`onFailure` 與失敗率門檻推 Discord；單一行政區失敗不吵人，整批失敗才告警（見 [D5](data-pipeline.md)）。
- **對外部 API 限流的防禦**：TDX 連續 6 次就 429，改成排程統一抓、縣市依序請求、間隔 500 ms、429 等 5 秒重試一次就停，使用者請求不直接打 TDX。
- **索引用數據說話**：灌 6 萬條路線的假資料，在 CI 用 optimizer hint 產生「沒有索引」的對照，查詢沒用上預期索引 CI 就轉紅（`backend/docs/db-tuning.md`）。
- **測試雙軌**：純函式 31 個單元測試檔（Playwright test runner，389 個案例）＋ Playwright E2E 跑桌機與手機兩種視窗；後端 pytest＋ruff，CI 另跑真實 MySQL 8.4。
- **GPX 安全解析**：後端用 defusedxml 擋 XXE 與實體展開攻擊；S3 key 由後端推得、presigned POST 限檔案大小，前端無法指定路徑。
