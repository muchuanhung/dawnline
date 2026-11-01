/**
 * 今日判讀切換列的自訂順序，兩種存法：
 * - 登入（我的路線）：FastAPI 後端 /api/v1/me/route-order，存在帳號上，跨裝置同步。
 *   路線 id 規則同收藏：公開路線 slug、私人路線 ULID。後端整份取代，看不到的路線會略過。
 * - 未登入（公開路線）：存在這台裝置的 cookie（PUBLIC_ORDER_COOKIE），伺服器頁面讀得到。
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

/** 未登入時公開路線的順序（這台裝置）；值為 JSON 字串陣列 */
export const PUBLIC_ORDER_COOKIE = "dawnline-public-order";

/** 與後端 ORDER_MAX 一致；cookie 也不該無限長 */
export const ORDER_MAX = 100;

/** cookie 值轉成 id 陣列；格式不對回空陣列（用預設順序），重複只留第一次 */
export function parseOrderCookie(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    const ids = parsed.filter((x): x is string => typeof x === "string" && x.length > 0 && x.length <= 200);
    return [...new Set(ids)].slice(0, ORDER_MAX);
  } catch {
    return [];
  }
}

export function serializeOrderCookie(ids: readonly string[]): string {
  return JSON.stringify([...new Set(ids)].slice(0, ORDER_MAX));
}
