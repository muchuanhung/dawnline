/**
 * 「我的路線」自訂順序（需登入）：呼叫 FastAPI 後端 /api/v1/me/route-order，存在帳號上，跨裝置同步。
 * 路線 id 規則同收藏：公開路線 slug、私人路線 ULID。後端整份取代，看不到的路線會略過。
 */

import { request } from "@/lib/routes/private-routes";

export interface RouteOrder {
  ids: string[];
}

const API_BASE = "/api/v1/me/route-order";

export function saveRouteOrder(ids: string[]): Promise<RouteOrder> {
  return request<RouteOrder>(
    "",
    { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids }) },
    API_BASE
  );
}
