# 前端錯誤追蹤（Sentry）

追蹤 Next.js 前端的程式錯誤：瀏覽器端未處理的例外、React 畫面出錯、伺服器端 Server Component／API route／proxy 的未處理例外，以及既有 `reportError()` 回報的上游失敗（CWB、TDX、Firestore、Inngest）。

後端（FastAPI）不在這份文件的範圍。

## 預設不啟用

沒設 `NEXT_PUBLIC_SENTRY_DSN` 就完全不送資料。只有「有 DSN、production build、不是 Vercel preview」同時成立才啟用，本機與 preview 都不送。

## 設定步驟

1. 在 Sentry 建一個 Next.js 專案，複製 DSN。
2. Vercel → Project → Settings → Environment Variables，加在 **Production**：

   | 變數 | 用途 | 必要 |
   |---|---|---|
   | `NEXT_PUBLIC_SENTRY_DSN` | 瀏覽器與伺服器端共用；DSN 本來就是公開的 | 是 |
   | `SENTRY_ORG`、`SENTRY_PROJECT`、`SENTRY_AUTH_TOKEN` | 建置時上傳 source map，錯誤堆疊才看得到原始碼位置 | 否，沒設只是堆疊是壓縮後的 |

   `SENTRY_AUTH_TOKEN` 只給 `project:releases` 與 `org:read` 權限，**不要**加 `NEXT_PUBLIC_` 前綴。
3. 重新部署。
4. 回報一則測試錯誤（見下）。

## 驗證

本機用 production build 接真的 DSN 試：

```bash
cd strava-route-system/apps/web
NEXT_PUBLIC_SENTRY_DSN=<DSN> pnpm build && NEXT_PUBLIC_SENTRY_DSN=<DSN> pnpm start
```

打開 http://localhost:3000，在瀏覽器 Console 執行：

```js
setTimeout(() => { throw new Error("sentry 測試（可忽略）"); });
```

Sentry 的 Issues 應該在幾秒內出現這則錯誤，environment 是 `local`。測完到 Sentry 把它 Resolve 並刪除。

## 隱私

路線與位置是隱私資料，送出前由 `src/lib/observability/sentry-options.ts` 清理：

- 不送使用者資訊與 IP（`sendDefaultPii: false`，並移除 `event.user`）。
- 移除 cookie、request body、`authorization`、`x-forwarded-for` 等標頭。
- 網址只留路徑，query 與 hash 一律移除。
- console 麵包屑整個丟掉；fetch／導覽麵包屑的網址移除 query。
- 不開效能追蹤，不開 Session Replay。

錯誤訊息本身不會被清理，所以 `throw new Error(...)` 時不要把 GPX 內容、路線名稱或使用者資料放進訊息。

這些規則有單元測試：`tests/unit/sentry-options.spec.ts`。隱私政策的「第三方服務」已列出 Sentry。

## 關閉

在 Vercel 刪掉 `NEXT_PUBLIC_SENTRY_DSN` 並重新部署即可，不用改程式。

## 代價

全站 JS 約增加 43 KB（壓縮後，530 → 573 KB，+8%），因為瀏覽器端 SDK 在每一頁都會載入。手機探索頁效能原本就是已知問題（Lighthouse 37），上線後請重跑 Lighthouse 確認沒有明顯變差。若影響明顯，下一步是改成 idle 時才初始化。
