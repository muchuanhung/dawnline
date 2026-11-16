# Lighthouse 檢查（2026/11/8，11/16 手機重跑）

> 對正式站 `dawnline-tw.vercel.app` 跑 Lighthouse 12.6.1，main `45393c4`（#99、#100 合併前）。手機用 Lighthouse 預設的模擬（慢速 4G、CPU 放慢 4 倍），桌機用 `--preset=desktop`。量測時經過雲端容器的 proxy，絕對數字會比實際手機慢，頁面之間的相對差距可以參考。

## 分數

| 頁面 | 裝置 | 效能 | 無障礙 | 最佳做法 | SEO | LCP | TBT | CLS |
|---|---|---|---|---|---|---|---|---|
| 首頁 `/` | 桌機 | 92 | 96 | 100 | 100 | 1.5 s | 50 ms | 0 |
| 首頁 `/` | 手機 | 71 | 96 | 100 | 100 | 6.3 s | 210 ms | 0 |
| 探索路線 `/routes` | 桌機 | 84 | 97 | 100 | 100 | 1.9 s | 140 ms | 0.078 |
| 探索路線 `/routes` | 手機 | **37** | 100 | 100 | 100 | **10.0 s** | 920 ms | **0.208** |
| 今日判讀 `/dashboard` | 桌機 | 98 | 100 | 100 | 66 | 1.1 s | 20 ms | 0.008 |
| 今日判讀 `/dashboard` | 手機 | 85 | 100 | 100 | 66 | 3.6 s | 210 ms | 0 |

今日判讀的 SEO 66 是刻意的：`src/app/robots.ts` 排除 `/dashboard`、`/profile`、`/api/`，這些頁面不需要被搜尋引擎收錄。

## 已修正（#100）

| 問題 | 位置 | 修正前 | 修正後 |
|---|---|---|---|
| 狀態／難度標籤文字對比不足（WCAG AA 要 4.5:1） | 探索頁路線卡片 `route-card.tsx` | 10px 純狀態色字放在同色淡底，約 1.9–2.1:1 | 文字改用 `color-mix(in oklab, 狀態色 35%, var(--foreground))`，淺色模式變深、深色模式變亮；淺色選中卡片最低 5.6:1、深色最低 9.0:1。底色與圓點維持原狀態色 |
| 觸控目標太小（至少 24 × 24 px） | 登入表單「顯示密碼」按鈕 `auth-form.tsx` | 16 × 16 px | 36 × 36 px，圖示位置不變 |

對比數值是用 Chromium 把 `color-mix` 與半透明底色實際算成 sRGB 後計算，涵蓋安全、注意、危險、未判定四種顏色。

## 已知限制：手機版探索路線偏慢

- **伺服器不是瓶頸**：`/routes` 文件的 TTFB 約 0.6 秒。
- **標題等 JS 跑完才畫出**：LCP 元素是頁面上的 `<h2>` 標題，10 秒裡 Render Delay 佔 9.4 秒；JS 執行合計約 2.4 秒（模擬 CPU 放慢 4 倍後）。
- **版面跳動**：清單與頁尾在資料載入後位移，CLS 0.208（良好門檻 0.1）。
- **一次下載約 1.4 MB**：含路線 GPX、Firebase Auth 的 iframe 與字型。

下一步（凍結後）：標題與清單外框改由伺服器先渲染、地圖與路線資料延後載入、清單先保留高度避免跳動、未登入時延後載入 Firebase Auth。

## 11/16 手機重跑（Sentry 上線後）

> 前端 Sentry（#106）上線後重跑手機版，確認多出來的 JS 有沒有讓效能變差。正式站部署的是 main `ac82078`（#107）；#107 只改後端 workflow 與文件，前端程式和 #106 相同。Lighthouse 12.6.1，手機預設模擬，同樣經過雲端容器的 proxy。每頁連跑 3 次取效能分數的中位數，下表其他欄位都取自中位數那一次。

| 頁面 | 效能（3 次） | 效能 11/8 → 11/16 | LCP | TBT | CLS |
|---|---|---|---|---|---|
| 首頁 `/` | 71、69、68 | 71 → **69** | 6.3 → 6.8 s | 210 → **306 ms** | 0 → 0 |
| 探索路線 `/routes` | 35、44、47 | 37 → **44** | 10.0 → 10.9 s | 920 → **1106 ms** | 0.208 → 0.09 |
| 今日判讀 `/dashboard` | 80、75、85 | 85 → **80** | 3.6 → 3.8 s | 210 → **345 ms** | 0 → 0 |

無障礙、最佳做法都是 100。SEO：首頁與探索路線 100，今日判讀維持 66（原因見上）。

結論：

- **效能分數沒有明顯變差**：同一頁連跑三次可以差到 12 分（探索路線 35～47），37 → 44 在浮動範圍內，不算進步。11/8 的數字沒有註明跑幾次。
- **TBT 三頁都多了約 100～190 ms**：唯一方向一致的變化，符合 Sentry 瀏覽器端 SDK 每一頁都載入、初始化的代價（見 `docs/sentry.md`「代價」）；但這段期間也升級了 Next.js（#99），沒有分開量，不能全算在 Sentry。探索路線原本就超過 900 ms，現在超過 1.1 秒。
- **探索路線 CLS 0.208 → 0.09**：11/8 之後還有其他前端變更（#99 Next.js 升級、#100、#105、#106），不能歸因於某一個 PR。
- 探索路線中位數那次：Script 傳輸約 620 KB，整頁約 1.6 MB。

下一步：若要把 TBT 降回來，把 Sentry 改成瀏覽器閒置時才初始化；探索路線的根本問題仍是上一節列的 JS 跑完才畫出標題。

## 怎麼重跑

```bash
npx lighthouse@12.6.1 https://dawnline-tw.vercel.app/routes \
  --only-categories=performance,accessibility,best-practices,seo \
  --output=html --output-path=./routes-mobile.html
```

桌機加 `--preset=desktop`。Lighthouse 每次結果會有幾分浮動，比較前後差異時同一台機器、同一個網路連跑幾次取中位數。

雲端容器沒有 Chrome 時，指定 Playwright 內建的 Chromium：

```bash
CHROME_PATH=/opt/pw-browsers/chromium-1243/chrome-linux64/chrome \
  npx lighthouse@12.6.1 https://dawnline-tw.vercel.app/routes \
  --only-categories=performance,accessibility,best-practices,seo \
  --chrome-flags="--headless=new --no-sandbox" \
  --output=json --output=html --output-path=./routes-mobile
```
