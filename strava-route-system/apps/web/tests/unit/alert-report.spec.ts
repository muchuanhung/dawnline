import { test, expect } from "@playwright/test";
import { sendTestAlert } from "@/lib/observability/report";

const realFetch = globalThis.fetch;
const realUrl = process.env.ALERT_WEBHOOK_URL;

test.afterEach(() => {
  globalThis.fetch = realFetch;
  if (realUrl === undefined) delete process.env.ALERT_WEBHOOK_URL;
  else process.env.ALERT_WEBHOOK_URL = realUrl;
});

function stubFetch(respond: () => Promise<Response>) {
  const calls: { url: string; body: unknown }[] = [];
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init?.body)) });
    return respond();
  }) as typeof fetch;
  return calls;
}

test.describe("sendTestAlert", () => {
  test("沒設 ALERT_WEBHOOK_URL 時不送，回 no-webhook", async () => {
    delete process.env.ALERT_WEBHOOK_URL;
    const calls = stubFetch(async () => new Response(null, { status: 204 }));
    expect(await sendTestAlert()).toEqual({ sent: false, reason: "no-webhook" });
    expect(calls).toHaveLength(0);
  });

  test("送出 Slack 格式 { text }，連續兩次都會送（不走節流）", async () => {
    process.env.ALERT_WEBHOOK_URL = "https://example.test/hook/slack";
    const calls = stubFetch(async () => new Response(null, { status: 200 }));
    expect(await sendTestAlert("hello")).toEqual({ sent: true, status: 200 });
    expect(await sendTestAlert()).toEqual({ sent: true, status: 200 });
    expect(calls).toHaveLength(2);
    expect(calls[0]!.url).toBe("https://example.test/hook/slack");
    expect((calls[0]!.body as { text: string }).text).toMatch(/^\[曉行\] 測試告警（.+）：hello$/);
  });

  test("webhook 回非 2xx 時回 webhook-rejected 與狀態碼", async () => {
    process.env.ALERT_WEBHOOK_URL = "https://example.test/hook";
    stubFetch(async () => new Response("bad", { status: 400 }));
    expect(await sendTestAlert()).toEqual({ sent: false, reason: "webhook-rejected", status: 400 });
  });

  test("連不到 webhook 時回 webhook-unreachable，不丟例外", async () => {
    process.env.ALERT_WEBHOOK_URL = "https://example.test/hook";
    stubFetch(async () => {
      throw new Error("ECONNREFUSED");
    });
    expect(await sendTestAlert()).toEqual({ sent: false, reason: "webhook-unreachable", message: "ECONNREFUSED" });
  });
});
