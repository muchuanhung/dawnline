import { test, expect } from "@playwright/test";
import { fetchPublicRoutesFromBackend, loadPublicRoutesWithFallback } from "@/lib/routes/public-routes.server";
import { demoRouteGpx } from "@/lib/routes/demo-route";
import type { Route } from "@/lib/routes/route-data";

const BACKEND = "https://api.example.test";
const S3 = (slug: string) => `https://bucket.s3.example.test/${slug}.gpx?sig=1`;

/** Replace global fetch for one test; records every call */
function mockFetch(handler: (url: string) => Response) {
  const calls: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    return handler(url);
  }) as typeof fetch;
  return { calls, restore: () => (globalThis.fetch = original) };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const meta = (id: string) => ({ id, name: id, type: "自行車", distanceKm: 1, elevationGainM: 1, updatedAt: "" });

test.describe("fetchPublicRoutesFromBackend", () => {
  test.afterEach(() => {
    delete process.env.BACKEND_API_URL;
  });

  test("沒設定後端回 null，不呼叫 fetch", async () => {
    delete process.env.BACKEND_API_URL;
    const m = mockFetch(() => json({}));
    try {
      expect(await fetchPublicRoutesFromBackend()).toBeNull();
      expect(m.calls).toHaveLength(0);
    } finally {
      m.restore();
    }
  });

  test("id 用 slug、GPX 從 presigned URL 讀；單條失敗只略過那條", async () => {
    process.env.BACKEND_API_URL = `${BACKEND}/`;
    const m = mockFetch((url) => {
      if (url === `${BACKEND}/api/v1/public-routes`) return json({ routes: [meta("yangjin"), meta("壞掉"), meta("wuling")] });
      if (url === `${BACKEND}/api/v1/public-routes/yangjin/gpx`) return json({ url: S3("yangjin") });
      if (url === `${BACKEND}/api/v1/public-routes/wuling/gpx`) return json({ url: S3("wuling") });
      if (url === `${BACKEND}/api/v1/public-routes/${encodeURIComponent("壞掉")}/gpx`) return json({}, 404);
      if (url.startsWith("https://bucket.")) return new Response(demoRouteGpx());
      return new Response("unexpected", { status: 500 });
    });
    try {
      const routes = await fetchPublicRoutesFromBackend();
      expect(routes?.map((r) => r.id).sort()).toEqual(["wuling", "yangjin"]);
      expect(routes?.[0].segments.length).toBeGreaterThan(0);
    } finally {
      m.restore();
    }
  });

  test("清單失敗丟錯（交給 fallback）", async () => {
    process.env.BACKEND_API_URL = BACKEND;
    const m = mockFetch(() => json({}, 503));
    try {
      await expect(fetchPublicRoutesFromBackend()).rejects.toThrow("503");
    } finally {
      m.restore();
    }
  });
});

test.describe("loadPublicRoutesWithFallback", () => {
  const route = { id: "from-backend" } as Route;
  const storageRoute = { id: "from-storage" } as Route;
  const storage = async () => [storageRoute];

  test("後端有資料就不讀 Storage", async () => {
    let storageCalled = false;
    const routes = await loadPublicRoutesWithFallback({
      backend: async () => [route],
      storage: async () => ((storageCalled = true), [storageRoute]),
    });
    expect(routes).toEqual([route]);
    expect(storageCalled).toBe(false);
  });

  test("後端未設定、空清單或出錯都退回 Storage", async () => {
    for (const backend of [async () => null, async () => [], async () => Promise.reject(new Error("down"))]) {
      expect(await loadPublicRoutesWithFallback({ backend, storage })).toEqual([storageRoute]);
    }
  });
});
