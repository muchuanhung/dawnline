// 瀏覽器端：Next.js 在 hydration 前自動載入。
// 這裡不直接 import @sentry/nextjs：第一次發生錯誤時才下載 SDK 並初始化，沒出錯的使用者不付這個成本。
import { initSentryOnFirstError } from "@/lib/observability/sentry-client";

initSentryOnFirstError(process.env.NEXT_PUBLIC_SENTRY_DSN);
