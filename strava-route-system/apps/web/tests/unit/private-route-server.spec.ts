import { test, expect } from "@playwright/test";
import { loadPrivateRoute, PrivateRouteError } from "@/lib/routes/private-route.server";
import { demoRouteGpx } from "@/lib/routes/demo-route";

const ID = "01JABCDEFGHJKMNPQRSTVWXYZ0";
const BACKEND = "https://api.example.test";
const S3_URL = "https://bucket.s3.example.test/users/1/routes/x.gpx?sig=1";

type Handler = (url: string, init?: RequestInit) => Response;

/** Replace global fetch for one test; records every call */
function mockFetch(handler: Handler) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    return handler(url, init);
  }) as typeof fetch;
  return { calls, restore: () => (globalThis.fetch = original) };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const listOf = (status = "ready") => ({
  routes: [{ id: ID, name: "我的七星山", type: "健行", status, distanceKm: 11, elevationGainM: 300, fileSize: 1, createdAt: "" }],
  limit: 10,
});

test.describe("loadPrivateRoute", () => {
  test.beforeEach(() => {
    process.env.BACKEND_API_URL = `${BACKEND}/`;
  });

  test("用後端的名稱與類型，帶使用者 cookie 呼叫後端，GPX 從 S3 讀", async () => {
    const m = mockFetch((url) => {
      if (url === `${BACKEND}/api/v1/routes`) return json(listOf());
      if (url === `${BACKEND}/api/v1/routes/${ID}/gpx`) return json({ url: S3_URL });
      if (url === S3_URL) return new Response(demoRouteGpx());
      return new Response("unexpected", { status: 500 });
    });
    try {
      const route = await loadPrivateRoute(ID, "rc_session=abc");
      expect(route.id).toBe(ID);
      expect(route.name).toBe("我的七星山");
      expect(route.type).toBe("健行");
      expect(route.segments.length).toBeGreaterThan(0);
      const backendCalls = m.calls.filter((c) => c.url.startsWith(BACKEND));
      expect(backendCalls).toHaveLength(2);
      for (const c of backendCalls) expect((c.init?.headers as Record<string, string>).cookie).toBe("rc_session=abc");
      // S3 presigned URL 不帶使用者 cookie
      expect(m.calls.find((c) => c.url === S3_URL)?.init?.headers).toBeUndefined();
    } finally {
      m.restore();
    }
  });

  test("不是 ULID 的 id 直接 404，不呼叫後端", async () => {
    const m = mockFetch(() => json(listOf()));
    try {
      await expect(loadPrivateRoute("../me", "")).rejects.toMatchObject({ status: 404 });
      expect(m.calls).toHaveLength(0);
    } finally {
      m.restore();
    }
  });

  test("清單裡沒有（別人的路線）或還沒處理完都是 404", async () => {
    for (const body of [{ routes: [], limit: 10 }, listOf("processing")]) {
      const m = mockFetch(() => json(body));
      try {
        await expect(loadPrivateRoute(ID, "")).rejects.toMatchObject({ status: 404 });
      } finally {
        m.restore();
      }
    }
  });

  test("後端 401 轉成 401，讓前端重換 session", async () => {
    const m = mockFetch(() => json({ error: { code: "unauthenticated" } }, 401));
    try {
      const err = await loadPrivateRoute(ID, "").catch((e: unknown) => e);
      expect(err).toBeInstanceOf(PrivateRouteError);
      expect((err as PrivateRouteError).status).toBe(401);
    } finally {
      m.restore();
    }
  });

  test("沒設定 BACKEND_API_URL 回 503", async () => {
    delete process.env.BACKEND_API_URL;
    await expect(loadPrivateRoute(ID, "")).rejects.toMatchObject({ status: 503 });
  });

  test("S3 讀取失敗回 502", async () => {
    const m = mockFetch((url) => {
      if (url === `${BACKEND}/api/v1/routes`) return json(listOf());
      if (url.endsWith("/gpx")) return json({ url: S3_URL });
      return new Response("denied", { status: 403 });
    });
    try {
      await expect(loadPrivateRoute(ID, "")).rejects.toMatchObject({ status: 502 });
    } finally {
      m.restore();
    }
  });
});
