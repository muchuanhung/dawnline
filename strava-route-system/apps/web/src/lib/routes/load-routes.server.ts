/**
 * 從 Firebase Storage 讀取並解析 GPX 路線（伺服器端專用）
 * 供 /api/routes/gpx 與 Server Component 共用。
 */

import { unstable_cache } from "next/cache";
import { getFirebaseAdmin } from "@/lib/firebase/admin";
import { parseGpxPoints, parseGpxToRoute } from "@/lib/routes/parse-gpx";
import { getSegmentsFromPoints } from "@/lib/routes/geocode-districts";
import type { Route } from "@/lib/routes/route-data";
import { DEMO_ROUTE_ID, DEMO_ROUTE_NAME, demoRouteGpx } from "@/lib/routes/demo-route";

const ROUTES_FOLDER = "gpx/routes";
/** 下載並解析 8 條 GPX 約需 10 秒；路線很少變動，快取 10 分鐘 */
const ROUTES_REVALIDATE_SECONDS = 600;

async function fetchRoutesFromStorage(): Promise<Route[]> {
  const bucketName = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;
  const bucket = getFirebaseAdmin().storage().bucket(bucketName || undefined);
  const [files] = await bucket.getFiles({ prefix: `${ROUTES_FOLDER}/` });

  const gpxFiles = files.filter((f) => f.name.endsWith(".gpx"));
  const parsed = await Promise.all(
    gpxFiles.map(async (file) => {
      const routeId = file.name.replace(/\.gpx$/i, "").split("/").pop() ?? "";
      try {
        const [contents] = await file.download();
        const xml = contents.toString("utf-8");
        const { points } = parseGpxPoints(xml);
        return parseGpxToRoute(xml, routeId, getSegmentsFromPoints(points));
      } catch (err) {
        console.warn(`無法解析 GPX ${routeId}:`, err);
        return null;
      }
    })
  );
  return parsed.filter((r): r is Route => r !== null).sort((a, b) => a.name.localeCompare(b.name));
}

/** 快取鍵帶版本：路段取樣方式改變時遞增，避免沿用舊格式的快取 */
const loadStorageRoutes = unstable_cache(fetchRoutesFromStorage, ["gpx-routes", "segments-v2"], {
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
 * 全部路線（依名稱排序），快取 10 分鐘。
 * Storage 讀取失敗或沒有任何路線時改回傳示意路線；失敗不進快取，下次仍會重試 Storage。
 */
export async function loadRoutes(): Promise<Route[]> {
  try {
    const routes = await loadStorageRoutes();
    if (routes.length > 0) return routes;
    console.warn("Storage 沒有可用的 GPX 路線，改用示意路線");
  } catch (err) {
    console.warn("Storage 路線讀取失敗，改用示意路線:", err instanceof Error ? err.message : err);
  }
  return [buildDemoRoute()];
}
