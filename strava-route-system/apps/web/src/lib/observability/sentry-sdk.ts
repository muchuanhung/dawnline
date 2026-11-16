/**
 * 瀏覽器端實際用到的 Sentry API，由 sentry-client 動態載入。
 * 直接 import("@sentry/nextjs") 會把整個套件（含沒用到的效能追蹤等）打包進同一個 chunk；
 * 經過這個只具名匯入兩個函式的模組，打包時才能把沒用到的程式碼搖掉。
 */
export { captureException, init } from "@sentry/nextjs";
