/**
 * 公開路線（伺服器端專用）：供 /api/routes/gpx、判讀與 Server Component 共用。
 * 來源：FastAPI 後端（MySQL＋S3，T6 起）；後端未設定、出錯或清單是空的時，過渡期退回 Firebase Storage。
 * TODO(T6)：凍結前確認後端穩定後刪掉 Firebase Storage fallback。
 */

import { unstable_cache } from "next/cache";
import { getFirebaseAdmin } from "@/lib/firebase/admin";
import { parseGpxPoints, parseGpxToRoute } from "@/lib/routes/parse-gpx";
import { getSegmentsFromPoints } from "@/lib/routes/geocode-districts";
import type { Route } from "@/lib/routes/route-data";
import { DEMO_ROUTE_ID, DEMO_ROUTE_NAME, demoRouteGpx } from "@/lib/routes/demo-route";
import { fetchPublicRoutesFromBackend, loadPublicRoutesWithFallback } from "@/lib/routes/public-routes.server";

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

function fetchPublicRoutes(): Promise<Route[]> {
  return loadPublicRoutesWithFallback({ backend: fetchPublicRoutesFromBackend, storage: fetchRoutesFromStorage });
}

/** 快取鍵帶版本：路段取樣方式或來源改變時遞增，避免沿用舊格式的快取 */
const loadCachedPublicRoutes = unstable_cache(fetchPublicRoutes, ["gpx-routes", "segments-v2", "source-backend"], {
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
 * 後端與 Storage 都讀取失敗時只剩示意路線；失敗不進快取，下次仍會重試。
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
