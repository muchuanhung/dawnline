// 瀏覽器端：Next.js 在 hydration 前自動載入。
import * as Sentry from "@sentry/nextjs";
import { getSentryOptions } from "@/lib/observability/sentry-options";

Sentry.init(getSentryOptions(process.env.NEXT_PUBLIC_SENTRY_DSN));
