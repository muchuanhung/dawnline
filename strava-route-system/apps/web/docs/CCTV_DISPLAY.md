# CCTV 即時影像顯示說明

## 資料來源

1. **TDX 道路 CCTV**：交通部運輸資料流通服務（縣市、高公局、公路總局）
2. **靜態補充**：TDX 未涵蓋的國家公園景點（陽明山冷水坑、七星公園、擎天崗、小油坑等），來源 [tw.live](https://tw.live/)

## 為何部分監視器無法在頁面內顯示

TDX 回傳的 CCTV 資料來自各縣市、高公局、公路總局等不同來源，部分無法在 iframe 內嵌入顯示，原因包括：

### 1. X-Frame-Options / CSP 禁止嵌入

部分政府網站設定 `X-Frame-Options: DENY` 或 CSP `frame-ancestors 'none'`，瀏覽器會阻擋 iframe 載入。

**已列入黑名單的網域**（`src/lib/cctv/embed-policy.ts` 內 `BLOCKED_IFRAME_DOMAINS`）：

- `atis.ntpc.gov.tw`（新北市交通局）
- `nfb.gov.tw`（高公局）
- `thb.gov.tw`（公路總局）
- `tw.live`（即時影像監視器，內嵌 YouTube 直播，擁有者禁止外部嵌入）

若發現其他網域也無法嵌入，可加入此清單。

### 2. 串流格式不支援 iframe

- **RTSP**（`rtsp://`）：需專用播放器，瀏覽器無法直接播放
- **HLS**（`.m3u8`）：需 video.js / hls.js 等播放器，單純 iframe 無法播放

此類 URL 會顯示「在新分頁開啟」連結。

### 3. 並發數限制（hls.bote.gov.taipei）

`hls.bote.gov.taipei` 來源同時僅允許約 6 個連線，故只對可見區域前 6 個監視器載入 iframe，其餘顯示「點擊或滾動至上方載入」。

### 4. 無 videoUrl

部分 TDX 資料無 `VideoStreamURL`，僅顯示佔位圖。

---

## 使用者體驗

- **可嵌入**：直接顯示即時影像
- **不可嵌入**：顯示佔位圖，hover 時出現「觀看即時影像」連結，點擊於新分頁開啟
