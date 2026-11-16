/**
 * 瀏覽器端 Sentry：第一次發生錯誤時才下載 SDK 並初始化。
 * 沒出錯的使用者完全不下載、不執行 SDK，不佔主執行緒。
 *
 * - 不啟用（沒有 DSN、非 production build、Vercel preview）時什麼都不做。
 * - SDK 載入前的錯誤先暫存（最多 MAX_EARLY_ERRORS 筆），初始化後補送；之後交給 Sentry 自己的全域處理。
 * - 代價：第一個錯誤之前的操作沒有 breadcrumbs（fetch、導覽紀錄）；SDK 下載完成前就離開頁面，錯誤會收不到。
 * - SDK 下載失敗（廣告攔截器、離線）時放棄，不重試，不影響頁面。
 *
 * 狀態放在 globalThis：instrumentation-client 與 global-error 不保證拿到同一個模組實例。
 */
import { getSentryOptions } from "./sentry-options";

/** SDK 載入前最多暫存幾筆錯誤：避免錯誤迴圈把記憶體吃光 */
export const MAX_EARLY_ERRORS = 10;

type Options = ReturnType<typeof getSentryOptions>;

interface SentryClientState {
  /** 已啟用時才有值；沒有就代表不回報 */
  options: Options | null;
  queue: unknown[];
  loader: (() => void) | null;
  ready: boolean;
}

const STATE_KEY = "__dawnlineSentryClient";

function state(): SentryClientState {
  const g = globalThis as typeof globalThis & { [STATE_KEY]?: SentryClientState };
  return (g[STATE_KEY] ??= { options: null, queue: [], loader: null, ready: false });
}

/** 暫存一筆錯誤；滿了就丟掉並回傳 false */
export function enqueueError(queue: unknown[], err: unknown, max = MAX_EARLY_ERRORS): boolean {
  if (queue.length >= max) return false;
  queue.push(err);
  return true;
}

/** 包成只會執行一次的觸發函式：重複呼叫（同時好幾個錯誤）也只載入一次，失敗也不重試 */
export function once(fn: () => void): () => void {
  let called = false;
  return () => {
    if (called) return;
    called = true;
    fn();
  };
}

/** 回報瀏覽器端的錯誤：SDK 已初始化就直接送；還沒就暫存，並觸發載入 */
export function captureClientError(err: unknown): void {
  const s = state();
  if (s.ready) {
    // 已初始化代表模組已載入，這裡的 import 直接拿快取
    void import("./sentry-sdk").then((Sentry) => Sentry.captureException(err));
    return;
  }
  if (!s.options) return;
  enqueueError(s.queue, err);
  s.loader?.();
}

/** 在 instrumentation-client 呼叫一次 */
export function initSentryOnFirstError(dsn: string | undefined): void {
  if (typeof window === "undefined") return;
  const options = getSentryOptions(dsn);
  if (!options.enabled) return;
  const s = state();
  s.options = options;

  // SDK 載入前的未處理錯誤由這裡接住；初始化後交給 Sentry 自己的全域處理
  const onError = (e: ErrorEvent) => {
    if (e.error != null) captureClientError(e.error);
  };
  const onRejection = (e: PromiseRejectionEvent) => captureClientError(e.reason);
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);
  const stopListening = () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
  };

  s.loader = once(() => {
    void import("./sentry-sdk")
      .then((Sentry) => {
        stopListening();
        Sentry.init(options);
        s.ready = true;
        for (const err of s.queue.splice(0)) Sentry.captureException(err);
      })
      .catch(() => {
        // SDK 下載失敗：放棄錯誤追蹤，不影響頁面
        stopListening();
        s.options = null;
        s.queue.length = 0;
      });
  });
}
