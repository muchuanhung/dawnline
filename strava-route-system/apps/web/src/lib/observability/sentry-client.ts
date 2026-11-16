/**
 * 瀏覽器端 Sentry：等頁面載入完、瀏覽器閒置時才下載 SDK 並初始化，不佔首屏的主執行緒。
 *
 * - 不啟用（沒有 DSN、非 production build、Vercel preview）時連 SDK 都不下載。
 * - 初始化前發生的錯誤先暫存（最多 MAX_EARLY_ERRORS 筆），初始化後補送；
 *   使用者在初始化前就離開頁面，這些錯誤會收不到。
 * - SDK 下載失敗（廣告攔截器、離線）時放棄，不影響頁面。
 *
 * 狀態放在 globalThis：instrumentation-client 與 global-error 不保證拿到同一個模組實例。
 */
import { getSentryOptions } from "./sentry-options";

/** 初始化前最多暫存幾筆錯誤：避免錯誤迴圈把記憶體吃光 */
export const MAX_EARLY_ERRORS = 10;
/** 頁面一直很忙時，最晚等多久就初始化 */
export const IDLE_TIMEOUT_MS = 5_000;
/** 瀏覽器不支援 requestIdleCallback（Safari）時，load 之後再等多久 */
export const IDLE_FALLBACK_MS = 1_000;

interface SentryClientState {
  queue: unknown[];
  ready: boolean;
}

const STATE_KEY = "__dawnlineSentryClient";

function state(): SentryClientState {
  const g = globalThis as typeof globalThis & { [STATE_KEY]?: SentryClientState };
  return (g[STATE_KEY] ??= { queue: [], ready: false });
}

/** 暫存一筆錯誤；滿了就丟掉並回傳 false */
export function enqueueError(queue: unknown[], err: unknown, max = MAX_EARLY_ERRORS): boolean {
  if (queue.length >= max) return false;
  queue.push(err);
  return true;
}

export interface IdleHost {
  requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => unknown;
  setTimeout: (cb: () => void, ms: number) => unknown;
}

/** 瀏覽器閒置時執行；不支援 requestIdleCallback 時延後 IDLE_FALLBACK_MS */
export function runWhenIdle(host: IdleHost, cb: () => void): void {
  if (typeof host.requestIdleCallback === "function") {
    host.requestIdleCallback(cb, { timeout: IDLE_TIMEOUT_MS });
  } else {
    host.setTimeout(cb, IDLE_FALLBACK_MS);
  }
}

/** 回報瀏覽器端的錯誤：Sentry 已初始化就直接送，還沒就先暫存 */
export function captureClientError(err: unknown): void {
  const s = state();
  if (!s.ready) {
    enqueueError(s.queue, err);
    return;
  }
  // 已初始化代表模組已載入，這裡的 import 直接拿快取
  void import("./sentry-sdk").then((Sentry) => Sentry.captureException(err));
}

/** 在 instrumentation-client 呼叫一次 */
export function initSentryWhenIdle(dsn: string | undefined): void {
  if (typeof window === "undefined") return;
  const options = getSentryOptions(dsn);
  if (!options.enabled) return;

  // 初始化前的未處理錯誤先接住；初始化後交給 Sentry 自己的全域處理
  const onError = (e: ErrorEvent) => {
    if (e.error != null) captureClientError(e.error);
  };
  const onRejection = (e: PromiseRejectionEvent) => captureClientError(e.reason);
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);
  const stopBuffering = () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
  };

  const load = async () => {
    const s = state();
    try {
      const Sentry = await import("./sentry-sdk");
      stopBuffering();
      Sentry.init(options);
      s.ready = true;
      for (const err of s.queue.splice(0)) Sentry.captureException(err);
    } catch {
      // SDK 下載失敗：放棄錯誤追蹤，不影響頁面
      stopBuffering();
      s.queue.length = 0;
    }
  };
  const start = () => runWhenIdle(window, () => void load());

  if (document.readyState === "complete") start();
  else window.addEventListener("load", start, { once: true });
}
