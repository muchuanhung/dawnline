# RWD：斷點規則與各頁截圖

> T9。截圖由 `tests/e2e/rwd-screens.spec.ts` 對正式站 `https://dawnline-tw.vercel.app` 產生（2026-11-07），每張是 viewport 首屏。
> 登入後的頁面用測試帳號截圖，帳號名稱、email、頭像一律遮成色塊；「我的路線」裡的路線是測試時上傳的暫存路線，截完就刪除。

## 結論

- 四種寬度：375（iPhone SE／mini）、768（iPad 直向）、1024（iPad 橫向，第一個桌機版面）、1440（筆電）。
- 公開頁與登入後頁面，**在這四種寬度都沒有橫向捲動**，由 E2E 守住：
  - 公開頁：`tests/e2e/responsive.spec.ts`（`/`、`/routes`、`/dashboard`，12 支）。
  - 登入後頁面：`tests/e2e/auth-pages-rwd.spec.ts`（今日判讀、我的路線、路線詳情、個人資料，16 支）。
- 手機與桌機的操作方式不同，各有一支 E2E 走完「上傳 → 判讀 → 刪除」：`tests/e2e/upload.spec.ts`。
  - 桌機：⋮ 選單刪除。
  - 手機（Pixel 7）：左滑刪除。

## 斷點規則

用 Tailwind 預設斷點，只用到兩個：`md`（768 px）與 `lg`（1024 px）。

| 寬度 | 導覽 | 路線頁（探索、我的路線） | 路線操作 |
|---|---|---|---|
| < 768 | 頁面底部固定的分頁列（今日判讀／路線／個人資料），留出 iPhone 底部安全區 | 單欄。探索路線的清單收在「路線列表」底部面板；我的路線直接列清單，點路線進詳情頁判讀 | 我的路線左滑露出改名、下載、刪除；刪除確認從底部滑出 |
| 768–1023 | 改成頂部置中的分頁切換，底部分頁列隱藏 | 仍是單欄；底部面板限寬 576 px、置中（平板直向不撐滿） | 同手機（平板是觸控裝置） |
| ≥ 1024 | 同上 | 左右兩欄：左欄 20 rem 清單，右欄判讀；我的路線選了路線就在右欄判讀，不換頁 | ⋮ 選單；刪除用瀏覽器確認框 |

其他規則：

- 路線名稱、數字列都允許換行（`break-words`、`flex-wrap`），長名稱不會撐出橫向捲動；375 px 的路線詳情就是例子。
- 桌機的 JS 判斷（左滑、選取方式、刪除確認）與 CSS 的 `lg` 用同一個斷點：`(min-width: 1024px)`。

## 截圖

每一列是同一頁在 375／768／1024／1440 的樣子。

### 公開頁（未登入）

| 頁面 | 375 | 768 | 1024 | 1440 |
|---|---|---|---|---|
| 首頁 `/` | ![](rwd/home-375.jpg) | ![](rwd/home-768.jpg) | ![](rwd/home-1024.jpg) | ![](rwd/home-1440.jpg) |
| 探索路線 `/routes` | ![](rwd/routes-375.jpg) | ![](rwd/routes-768.jpg) | ![](rwd/routes-1024.jpg) | ![](rwd/routes-1440.jpg) |
| 今日判讀 `/dashboard`（未登入） | ![](rwd/dashboard-guest-375.jpg) | ![](rwd/dashboard-guest-768.jpg) | ![](rwd/dashboard-guest-1024.jpg) | ![](rwd/dashboard-guest-1440.jpg) |

### 登入後頁面

| 頁面 | 375 | 768 | 1024 | 1440 |
|---|---|---|---|---|
| 今日判讀 `/dashboard`（已登入） | ![](rwd/dashboard-member-375.jpg) | ![](rwd/dashboard-member-768.jpg) | ![](rwd/dashboard-member-1024.jpg) | ![](rwd/dashboard-member-1440.jpg) |
| 我的路線 `/routes/private` | ![](rwd/private-routes-375.jpg) | ![](rwd/private-routes-768.jpg) | ![](rwd/private-routes-1024.jpg) | ![](rwd/private-routes-1440.jpg) |
| 路線詳情 `/routes/private/{id}` | ![](rwd/private-route-detail-375.jpg) | ![](rwd/private-route-detail-768.jpg) | ![](rwd/private-route-detail-1024.jpg) | ![](rwd/private-route-detail-1440.jpg) |
| 個人資料 `/profile` | ![](rwd/profile-375.jpg) | ![](rwd/profile-768.jpg) | ![](rwd/profile-1024.jpg) | ![](rwd/profile-1440.jpg) |

## T9 修過的問題（PR #85、#86）

- 平板直向的底部面板撐滿整個寬度 → 限寬 576 px 並置中（E2E：「平板直向的底部面板置中」）。
- 海拔圖的刻度在窄螢幕換行 → 不換行。
- 首頁免責聲明在手機上不易閱讀 → 修正為可讀。

修正前沒有留截圖，這份只有修正後的現況。

## 重新產生截圖

需要測試帳號（`E2E_USER_EMAIL`、`E2E_USER_PASSWORD`，放在 `apps/web/.env.local`）：

```bash
cd strava-route-system/apps/web
E2E_BASE_URL=https://dawnline-tw.vercel.app RWD_SCREENSHOT_DIR=../../../docs/rwd \
  pnpm exec playwright test --project=rwd-screens
```

不設 `E2E_BASE_URL` 時會在本機 build 後截本機版本。
