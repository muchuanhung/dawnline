import { test, expect } from "@playwright/test";
import {
  captureClientError,
  enqueueError,
  IDLE_FALLBACK_MS,
  IDLE_TIMEOUT_MS,
  initSentryWhenIdle,
  MAX_EARLY_ERRORS,
  runWhenIdle,
} from "@/lib/observability/sentry-client";

test.describe("enqueueError：初始化前暫存錯誤", () => {
  test("依序暫存，滿了就丟掉新的", () => {
    const q: unknown[] = [];
    for (let i = 0; i < MAX_EARLY_ERRORS; i++) expect(enqueueError(q, i)).toBe(true);
    expect(enqueueError(q, "overflow")).toBe(false);
    expect(q).toHaveLength(MAX_EARLY_ERRORS);
    expect(q[0]).toBe(0);
  });
});

test.describe("runWhenIdle：等瀏覽器閒置", () => {
  test("支援 requestIdleCallback：帶最長等待時間", () => {
    const calls: Array<{ timeout?: number }> = [];
    let timeoutUsed = false;
    runWhenIdle(
      {
        requestIdleCallback: (cb, opts) => {
          calls.push({ timeout: opts?.timeout });
          cb();
        },
        setTimeout: () => {
          timeoutUsed = true;
        },
      },
      () => {}
    );
    expect(calls).toEqual([{ timeout: IDLE_TIMEOUT_MS }]);
    expect(timeoutUsed).toBe(false);
  });

  test("不支援（Safari）：改用 setTimeout 延後", () => {
    let delay = -1;
    let ran = false;
    runWhenIdle(
      {
        setTimeout: (cb, ms) => {
          delay = ms;
          cb();
        },
      },
      () => {
        ran = true;
      }
    );
    expect(delay).toBe(IDLE_FALLBACK_MS);
    expect(ran).toBe(true);
  });
});

test.describe("captureClientError／initSentryWhenIdle", () => {
  test("沒有 window（伺服器端）：init 什麼都不做，錯誤只暫存不送", () => {
    expect(() => initSentryWhenIdle("https://publickey@o0.ingest.sentry.io/1")).not.toThrow();
    expect(() => captureClientError(new Error("boom"))).not.toThrow();
    const g = globalThis as unknown as { __dawnlineSentryClient?: { queue: unknown[]; ready: boolean } };
    expect(g.__dawnlineSentryClient?.ready).toBe(false);
    expect(g.__dawnlineSentryClient?.queue.length).toBeGreaterThan(0);
  });
});
