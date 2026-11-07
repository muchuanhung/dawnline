import { expect, type APIRequestContext, type Page } from "@playwright/test";
import type { PrivateRoute, PrivateRouteList } from "@/lib/routes/private-routes";

/**
 * 登入後 E2E 共用：用測試帳號在「我的路線」上傳暫時的 GPX，測完一定刪掉。
 * 名稱都以 E2E_ROUTE_PREFIX 開頭，清理時只刪這種路線，不動帳號原本的資料。
 */

export const E2E_ROUTE_PREFIX = "E2E 暫存路線";

/** 判讀結果（安全／注意／危險／未判定），與 routes.spec 同一個選取方式 */
export const verdictStatus = (page: Page) =>
  page.getByRole("status").filter({ hasText: /危險|注意|安全|未判定/ });

/** 台北大安區一段約 2 km 的路線；判讀需要的行政區與天氣都在台北 */
export function sampleGpx(name: string): string {
  const points = Array.from({ length: 21 }, (_, i) => {
    const lat = (25.026 + i * 0.00035).toFixed(5);
    const lon = (121.543 + i * 0.001).toFixed(5);
    return `      <trkpt lat="${lat}" lon="${lon}"><ele>${10 + (i % 5)}</ele></trkpt>`;
  }).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="dawnline-e2e" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <name>${name}</name>
    <type>cycling</type>
    <trkseg>
${points}
    </trkseg>
  </trk>
</gpx>
`;
}

/** 每次測試用不同名稱，桌機與手機同時跑也不會撞名 */
export const uniqueRouteName = (tag: string) => `${E2E_ROUTE_PREFIX} ${tag} ${Date.now().toString(36)}`;

export async function listPrivateRoutes(api: APIRequestContext): Promise<PrivateRouteList> {
  const res = await api.get("/api/v1/routes");
  expect(res.ok(), `/api/v1/routes → ${res.status()}`).toBeTruthy();
  return (await res.json()) as PrivateRouteList;
}

export async function findRouteByName(api: APIRequestContext, name: string): Promise<PrivateRoute | undefined> {
  return (await listPrivateRoutes(api)).routes.find((r) => r.name === name);
}

/** 額度還夠上傳一條嗎（測試帳號滿了就跳過，不刪使用者原本的路線） */
export async function hasUploadQuota(api: APIRequestContext): Promise<boolean> {
  const { routes, limit } = await listPrivateRoutes(api);
  return routes.length < limit;
}

/** 從「我的路線」頁的檔案選擇器上傳，等到成功提示出現；回傳後端建立的路線 */
export async function uploadViaPage(page: Page, name: string): Promise<PrivateRoute> {
  await page.locator('input[type="file"]').setInputFiles({
    name: `${name}.gpx`,
    mimeType: "application/gpx+xml",
    buffer: Buffer.from(sampleGpx(name)),
  });
  await expect(page.getByText(`已上傳「${name}」`)).toBeVisible({ timeout: 30_000 });
  const route = await findRouteByName(page.request, name);
  expect(route, `上傳後後端清單要有「${name}」`).toBeDefined();
  expect(route!.status).toBe("ready");
  return route!;
}

/** 清掉這次測試留下的暫存路線（測試中途失敗也會跑） */
export async function deleteRoutesNamed(api: APIRequestContext, names: Iterable<string>): Promise<void> {
  const wanted = new Set(names);
  if (wanted.size === 0) return;
  const { routes } = await listPrivateRoutes(api);
  for (const r of routes) {
    if (wanted.has(r.name) && r.name.startsWith(E2E_ROUTE_PREFIX)) {
      await api.delete(`/api/v1/routes/${encodeURIComponent(r.id)}`);
    }
  }
}

/** 手機的左滑：用 CDP 送觸控事件（Pointer Events 的 pointerType 才會是 touch） */
export async function swipeLeft(page: Page, x: number, y: number, distance: number): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  const point = (px: number) => [{ x: px, y, id: 1 }];
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: point(x) });
  const steps = 8;
  for (let i = 1; i <= steps; i++) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: point(x - (distance * i) / steps) });
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await cdp.detach();
}
