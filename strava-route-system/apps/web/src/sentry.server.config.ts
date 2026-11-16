// Node 伺服器端（API route、Server Component、Inngest）。由 instrumentation.ts 載入。
import * as Sentry from "@sentry/nextjs";
import { getSentryOptions } from "@/lib/observability/sentry-options";

Sentry.init(getSentryOptions(process.env.NEXT_PUBLIC_SENTRY_DSN));
