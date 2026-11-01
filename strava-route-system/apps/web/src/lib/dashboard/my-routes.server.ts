/**
 * 今日判讀「我的路線」（伺服器端專用）：帶使用者自己的 cookie（rc_session）向 FastAPI 後端
 * 讀收藏、自己上傳的路線與自訂順序，交給 pickMyRoutes 排序。
 * 任一個讀不到（未登入後端、session 過期、後端連不上）就回 null，Dashboard 改顯示公開路線，不擋判讀。
 */

import type { FavoriteList } from "@/lib/routes/favorites";
import type { PrivateRouteList } from "@/lib/routes/private-routes";
import { pickMyRoutes, type MyRoute } from "@/lib/dashboard/my-routes";
import type { RouteOrder } from "@/lib/dashboard/route-order";

async function backendJson<T>(path: string, cookie: string): Promise<T> {
  const base = process.env.BACKEND_API_URL?.replace(/\/+$/, "");
  if (!base) throw new Error("後端未設定（BACKEND_API_URL）");
  const res = await fetch(`${base}${path}`, { headers: { cookie }, cache: "no-store" });
  if (!res.ok) throw new Error(`後端 ${res.status}：${path}`);
  return (await res.json()) as T;
}

/** publicIds：目前公開路線的 id，用來略過已下架的公開收藏 */
export async function loadMyRoutes(cookie: string, publicIds: ReadonlySet<string>): Promise<MyRoute[] | null> {
  if (!cookie) return null;
  try {
    const [{ favorites }, { routes }, order] = await Promise.all([
      backendJson<FavoriteList>("/api/v1/favorites", cookie),
      backendJson<PrivateRouteList>("/api/v1/routes", cookie),
      // 自訂順序讀不到就用預設順序，不影響其他資料
      backendJson<RouteOrder>("/api/v1/me/route-order", cookie).then(
        (r) => r.ids,
        () => [] as string[]
      ),
    ]);
    // 全部回傳：切換列只顯示前 MY_ROUTES_MAX 條，其餘在「全部 N 條」面板裡
    return pickMyRoutes(favorites, routes, publicIds, Number.POSITIVE_INFINITY, order);
  } catch (err) {
    console.warn("我的路線讀取失敗，改顯示公開路線:", err instanceof Error ? err.message : err);
    return null;
  }
}
