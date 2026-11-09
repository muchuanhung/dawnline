# Lighthouse 檢查（2026/11/8）

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

## 怎麼重跑

```bash
npx lighthouse@12.6.1 https://dawnline-tw.vercel.app/routes \
  --only-categories=performance,accessibility,best-practices,seo \
  --output=html --output-path=./routes-mobile.html
```

桌機加 `--preset=desktop`。Lighthouse 每次結果會有幾分浮動，比較前後差異時同一台機器、同一個網路連跑幾次取中位數。
