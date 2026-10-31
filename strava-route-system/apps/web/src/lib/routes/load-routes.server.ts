/**
 * 公開路線（伺服器端專用）：供 /api/routes/gpx、判讀與 Server Component 共用。
 * 來源只有 FastAPI 後端（MySQL＋S3，T6 起）；讀不到時只剩示意路線，不退回其他來源。
 */

import { unstable_cache } from "next/cache";
import { parseGpxPoints, parseGpxToRoute } from "@/lib/routes/parse-gpx";
import { getSegmentsFromPoints } from "@/lib/routes/geocode-districts";
import type { Route } from "@/lib/routes/route-data";
import { DEMO_ROUTE_ID, DEMO_ROUTE_NAME, demoRouteGpx } from "@/lib/routes/demo-route";
import { fetchPublicRoutesFromBackend } from "@/lib/routes/public-routes.server";

/** 下載並解析全部公開路線 GPX 約需數秒；路線很少變動，快取 10 分鐘 */
const ROUTES_REVALIDATE_SECONDS = 600;

/** 快取鍵帶版本：路段取樣方式或來源改變時遞增，避免沿用舊格式的快取 */
const loadCachedPublicRoutes = unstable_cache(fetchPublicRoutesFromBackend, ["gpx-routes", "segments-v2", "source-backend"], {
  revalidate: ROUTES_REVALIDATE_SECONDS,
  tags: ["gpx-routes"],
});

/** 示意路線：與真實路線同一套 GPX 解析與行政區取樣 */
function buildDemoRoute(): Route {
  const xml = demoRouteGpx();
  const route = parseGpxToRoute(xml, DEMO_ROUTE_ID, getSegmentsFromPoints(parseGpxPoints(xml).points));
  return { ...route, name: DEMO_ROUTE_NAME, nameZh: DEMO_ROUTE_NAME, demo: true };
}

/**
 * 全部路線：示意路線固定排第一筆（demo 用），其後為公開路線（依名稱排序，快取 10 分鐘）。
 * 後端讀取失敗時只剩示意路線；失敗不進快取，下次仍會重試。
 */
export async function loadRoutes(): Promise<Route[]> {
  const demo = buildDemoRoute();
  try {
    return [demo, ...(await loadCachedPublicRoutes())];
  } catch (err) {
    console.warn("公開路線讀取失敗，只顯示示意路線:", err instanceof Error ? err.message : err);
    return [demo];
  }
}
