import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
}

// Next.js 在 Server Component、route handler、proxy 拋出未處理的錯誤時會呼叫它
export const onRequestError = Sentry.captureRequestError;
