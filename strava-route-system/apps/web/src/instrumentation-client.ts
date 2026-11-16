// 瀏覽器端：Next.js 在 hydration 前自動載入。
// 這裡不直接 import @sentry/nextjs：SDK 等頁面載入完、瀏覽器閒置時才下載並初始化，不佔首屏主執行緒。
import { initSentryWhenIdle } from "@/lib/observability/sentry-client";

initSentryWhenIdle(process.env.NEXT_PUBLIC_SENTRY_DSN);
