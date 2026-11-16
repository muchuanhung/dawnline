import { test, expect } from "@playwright/test";
import * as Sentry from "@sentry/nextjs";
import type { Breadcrumb, ErrorEvent } from "@sentry/nextjs";
import { getSentryOptions, scrubBreadcrumb, scrubEvent, stripQuery } from "@/lib/observability/sentry-options";
import { reportError } from "@/lib/observability/report";

const FAKE_DSN = "https://publickey@o0.ingest.sentry.io/1";

test.describe("stripQuery", () => {
  test("絕對網址只留 origin 與 path", () => {
    expect(stripQuery("https://dawnline-tw.vercel.app/routes?route=%E5%8D%97%E9%AF%A4%E9%AF%93&depart=2026-11-20T08:00#x")).toBe(
      "https://dawnline-tw.vercel.app/routes"
    );
  });
  test("相對路徑只留 path；空值原樣回傳", () => {
    expect(stripQuery("/api/v1/me/routes?cursor=abc")).toBe("/api/v1/me/routes");
    expect(stripQuery(undefined)).toBeUndefined();
  });
});

test.describe("scrubEvent：路線與位置是隱私資料", () => {
  test("移除使用者、cookie、request body、query、敏感標頭", () => {
    const event = {
      type: undefined,
      user: { id: "u1", email: "a@b.c", ip_address: "1.2.3.4" },
      request: {
        url: "https://dawnline-tw.vercel.app/routes?route=secret",
        query_string: "route=secret",
        cookies: { rc_session: "token" },
        data: "<gpx>…</gpx>",
        headers: { Cookie: "rc_session=token", Authorization: "Bearer x", "X-Forwarded-For": "1.2.3.4", Accept: "text/html" },
      },
    } as unknown as ErrorEvent;
    const out = scrubEvent(event)!;
    expect(out.user).toBeUndefined();
    expect(out.request?.cookies).toBeUndefined();
    expect(out.request?.data).toBeUndefined();
    expect(out.request?.query_string).toBeUndefined();
    expect(out.request?.url).toBe("https://dawnline-tw.vercel.app/routes");
    expect(out.request?.headers).toEqual({ Accept: "text/html" });
  });

  test("console 麵包屑整個丟掉；fetch／導覽網址移除 query", () => {
    const crumbs: Breadcrumb[] = [
      { category: "console", message: '{"scope":"tdx","county":"新北市"}' },
      { category: "fetch", data: { url: "/api/v1/me/routes?x=1", method: "GET" } },
      { category: "navigation", data: { from: "/routes?route=a", to: "/dashboard?tab=b" } },
    ];
    const out = scrubEvent({ breadcrumbs: crumbs } as unknown as ErrorEvent)!;
    expect(out.breadcrumbs).toHaveLength(2);
    expect(out.breadcrumbs![0]!.data!.url).toBe("/api/v1/me/routes");
    expect(out.breadcrumbs![1]!.data).toMatchObject({ from: "/routes", to: "/dashboard" });
    expect(scrubBreadcrumb({ category: "console" })).toBeNull();
  });
});

test.describe("getSentryOptions：什麼情況下才送資料", () => {
  const env = process.env as Record<string, string | undefined>;
  const backup = { ...env };
  test.afterEach(() => {
    for (const k of ["NODE_ENV", "NEXT_PUBLIC_VERCEL_ENV", "VERCEL_ENV"]) {
      if (backup[k] === undefined) delete env[k];
      else env[k] = backup[k];
    }
  });

  test("沒有 DSN：不啟用", () => {
    env.NODE_ENV = "production";
    expect(getSentryOptions(undefined).enabled).toBe(false);
    expect(getSentryOptions("").enabled).toBe(false);
  });
  test("有 DSN 但不是 production build：不啟用", () => {
    env.NODE_ENV = "development";
    expect(getSentryOptions(FAKE_DSN).enabled).toBe(false);
  });
  test("Vercel preview：不啟用；production：啟用", () => {
    env.NODE_ENV = "production";
    env.NEXT_PUBLIC_VERCEL_ENV = "preview";
    expect(getSentryOptions(FAKE_DSN).enabled).toBe(false);
    env.NEXT_PUBLIC_VERCEL_ENV = "production";
    const o = getSentryOptions(FAKE_DSN);
    expect(o.enabled).toBe(true);
    expect(o.environment).toBe("production");
  });
  test("不送預設個資", () => {
    expect(getSentryOptions(FAKE_DSN).sendDefaultPii).toBe(false);
  });
});

test.describe("reportError → Sentry（假 DSN，事件被攔下不會連網）", () => {
  test("同一個 scope／event 歸成一組，並帶 tags", async () => {
    const captured: ErrorEvent[] = [];
    Sentry.init({
      dsn: FAKE_DSN,
      enabled: true,
      beforeSend: (event) => {
        captured.push(event);
        return null; // 攔下，不送出
      },
    });
    const log = console.error;
    console.error = () => {}; // reportError 會 console.error，測試輸出不要被洗版
    try {
      reportError("tdx", "cctv-city-failed", new Error("boom"), { county: "新北市" });
      reportError("cwb", "district-weather-failed", "字串錯誤");
      await Sentry.flush(1000);
    } finally {
      console.error = log;
    }
    expect(captured).toHaveLength(2);
    expect(captured[0]!.tags).toMatchObject({ scope: "tdx", event: "cctv-city-failed" });
    expect(captured[0]!.fingerprint).toEqual(["tdx", "cctv-city-failed"]);
    expect(captured[0]!.extra).toMatchObject({ county: "新北市" });
    expect(captured[1]!.tags).toMatchObject({ scope: "cwb", event: "district-weather-failed" });
    expect(captured[1]!.exception?.values?.[0]?.value).toBe("字串錯誤");
  });
});
