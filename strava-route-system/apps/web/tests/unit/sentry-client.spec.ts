import { test, expect } from "@playwright/test";
import {
  captureClientError,
  enqueueError,
  initSentryOnFirstError,
  MAX_EARLY_ERRORS,
  once,
} from "@/lib/observability/sentry-client";

test.describe("enqueueError：SDK 載入前暫存錯誤", () => {
  test("依序暫存，滿了就丟掉新的", () => {
    const q: unknown[] = [];
    for (let i = 0; i < MAX_EARLY_ERRORS; i++) expect(enqueueError(q, i)).toBe(true);
    expect(enqueueError(q, "overflow")).toBe(false);
    expect(q).toHaveLength(MAX_EARLY_ERRORS);
    expect(q[0]).toBe(0);
  });
});

test.describe("once：第一次出錯才載入 SDK，只載入一次", () => {
  test("同時好幾個錯誤也只觸發一次載入", () => {
    let loads = 0;
    const trigger = once(() => {
      loads++;
    });
    trigger();
    trigger();
    trigger();
    expect(loads).toBe(1);
  });

  test("沒有出錯就不載入", () => {
    let loads = 0;
    once(() => {
      loads++;
    });
    expect(loads).toBe(0);
  });
});

test.describe("captureClientError／initSentryOnFirstError", () => {
  test("沒有 window（伺服器端）或未啟用：不暫存、不載入、不丟例外", () => {
    expect(() => initSentryOnFirstError("https://publickey@o0.ingest.sentry.io/1")).not.toThrow();
    expect(() => captureClientError(new Error("boom"))).not.toThrow();
    const g = globalThis as unknown as {
      __dawnlineSentryClient?: { queue: unknown[]; ready: boolean; options: unknown };
    };
    expect(g.__dawnlineSentryClient?.options).toBeNull();
    expect(g.__dawnlineSentryClient?.queue).toHaveLength(0);
    expect(g.__dawnlineSentryClient?.ready).toBe(false);
  });
});
