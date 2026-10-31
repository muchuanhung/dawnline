/**
 * 公開路線（伺服器端專用）：供 /api/routes/gpx、判讀與 Server Component 共用。
 * 來源只有 FastAPI 後端（MySQL＋S3，T6 起）；讀不到時回空清單，不退回其他來源。
 */

import { unstable_cache } from "next/cache";
import type { Route } from "@/lib/routes/route-data";
import { fetchPublicRoutesFromBackend } from "@/lib/routes/public-routes.server";

/** 下載並解析全部公開路線 GPX 約需數秒；路線很少變動，快取 10 分鐘 */
const ROUTES_REVALIDATE_SECONDS = 600;

/** 快取鍵帶版本：路段取樣方式或來源改變時遞增，避免沿用舊格式的快取 */
const loadCachedPublicRoutes = unstable_cache(fetchPublicRoutesFromBackend, ["gpx-routes", "segments-v2", "source-backend"], {
  revalidate: ROUTES_REVALIDATE_SECONDS,
  tags: ["gpx-routes"],
});

/**
 * 全部公開路線（依名稱排序，快取 10 分鐘）。
 * 後端讀取失敗時回空清單（畫面顯示空狀態，不會判成安全）；失敗不進快取，下次仍會重試。
 */
export async function loadRoutes(): Promise<Route[]> {
  try {
    return await loadCachedPublicRoutes();
  } catch (err) {
    console.warn("公開路線讀取失敗，回空清單:", err instanceof Error ? err.message : err);
    return [];
  }
}
