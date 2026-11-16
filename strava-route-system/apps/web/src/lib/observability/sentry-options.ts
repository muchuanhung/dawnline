/**
 * Sentry 共用設定（瀏覽器與 Node 伺服器端共用）。
 *
 * 設計原則：
 * 1. 沒設 NEXT_PUBLIC_SENTRY_DSN 就完全不啟用，不送任何資料；本機、preview 預設也不送。
 * 2. 只追蹤錯誤，不開效能追蹤（沒設 tracesSampleRate）、不開 Session Replay。
 * 3. 路線與位置是隱私資料：不送使用者資訊、IP、cookie、request body；網址只保留路徑，query 一律移除。
 */
import type { Breadcrumb, ErrorEvent } from "@sentry/nextjs";

const SENSITIVE_HEADERS = new Set(["cookie", "set-cookie", "authorization", "x-forwarded-for", "x-real-ip"]);

/** 只留 origin 與 path，移除 query 與 hash（路線名稱、出發時間、token 都可能在 query 裡） */
export function stripQuery(url: string | undefined): string | undefined {
  if (!url) return url;
  try {
    const u = new URL(url, "http://localhost");
    const isAbsolute = /^[a-z][a-z0-9+.-]*:\/\//i.test(url);
    return isAbsolute ? `${u.origin}${u.pathname}` : u.pathname;
  } catch {
    return url.split(/[?#]/)[0];
  }
}

/** 送出前清掉可能帶個資的欄位。回傳 null 代表整筆丟棄。 */
export function scrubEvent(event: ErrorEvent): ErrorEvent | null {
  delete event.user;
  if (event.request) {
    delete event.request.cookies;
    delete event.request.data;
    delete event.request.query_string;
    event.request.url = stripQuery(event.request.url);
    if (event.request.headers) {
      for (const key of Object.keys(event.request.headers)) {
        if (SENSITIVE_HEADERS.has(key.toLowerCase())) delete event.request.headers[key];
      }
    }
  }
  if (event.breadcrumbs) {
    event.breadcrumbs = event.breadcrumbs.map(scrubBreadcrumb).filter((b): b is Breadcrumb => b !== null);
  }
  return event;
}

/** console 內容可能夾帶路線資料，直接丟掉；fetch／xhr／導覽的網址移除 query */
export function scrubBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb | null {
  if (breadcrumb.category === "console") return null;
  const data = breadcrumb.data;
  if (data) {
    for (const key of ["url", "from", "to"] as const) {
      if (typeof data[key] === "string") data[key] = stripQuery(data[key] as string);
    }
  }
  return breadcrumb;
}

/** 瀏覽器擴充套件與瀏覽器本身的雜訊，不是我們的程式問題 */
const IGNORE_ERRORS = [
  "ResizeObserver loop limit exceeded",
  "ResizeObserver loop completed with undelivered notifications",
];
const DENY_URLS = [/^chrome-extension:\/\//i, /^moz-extension:\/\//i, /^safari-(web-)?extension:\/\//i];

export function getSentryOptions(dsn: string | undefined) {
  const environment = process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.VERCEL_ENV ?? "local";
  return {
    dsn,
    // 只在 production build 且有 DSN 時啟用；Vercel preview 不送，避免測試資料混進正式的錯誤清單
    enabled: Boolean(dsn) && process.env.NODE_ENV === "production" && environment !== "preview",
    environment,
    release: process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ?? process.env.VERCEL_GIT_COMMIT_SHA,
    sendDefaultPii: false,
    maxBreadcrumbs: 30,
    ignoreErrors: IGNORE_ERRORS,
    denyUrls: DENY_URLS,
    beforeSend: scrubEvent,
    beforeBreadcrumb: scrubBreadcrumb,
  };
}
