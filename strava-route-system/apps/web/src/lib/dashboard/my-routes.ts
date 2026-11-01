/**
 * 今日判讀「我的路線」：登入後路線切換列改放收藏與自己上傳的路線（T8）。
 * 純函式，資料由 my-routes.server.ts 從後端讀取後傳入。
 */

import type { FavoriteItem } from "@/lib/routes/favorites";
import type { PrivateRoute } from "@/lib/routes/private-routes";

/** 切換列最多幾條（與公開路線的快速切換同一個上限） */
export const MY_ROUTES_MAX = 5;

export interface MyRoute {
  /** 公開路線是 slug，私人路線是 ULID（與收藏 API 相同） */
  id: string;
  name: string;
  visibility: "public" | "private";
  /** favorite：收藏；own：自己上傳但沒收藏 */
  source: "favorite" | "own";
}

/**
 * 收藏在前（後端已依新到舊排序），再補自己上傳、尚未收藏的路線（新到舊），最多 max 條。
 * - 公開收藏只留目前公開清單裡還在的（路線下架就不顯示）；
 * - 私人路線只留處理完成（ready）的；收藏的私人路線一定是自己的，以自己的清單為準。
 */
export function pickMyRoutes(
  favorites: readonly FavoriteItem[],
  own: readonly PrivateRoute[],
  publicIds: ReadonlySet<string>,
  max = MY_ROUTES_MAX
): MyRoute[] {
  const ready = own.filter((r) => r.status === "ready");
  const readyById = new Map(ready.map((r) => [r.id, r]));
  const picked: MyRoute[] = [];
  const seen = new Set<string>();
  const push = (route: MyRoute) => {
    if (picked.length >= max || seen.has(route.id)) return;
    seen.add(route.id);
    picked.push(route);
  };

  for (const f of favorites) {
    if (f.visibility === "public") {
      if (publicIds.has(f.id)) push({ id: f.id, name: f.name, visibility: "public", source: "favorite" });
    } else {
      const mine = readyById.get(f.id);
      // Name from the route list: renames show up even if the favourite row lags behind
      if (mine) push({ id: mine.id, name: mine.name, visibility: "private", source: "favorite" });
    }
  }

  const newestFirst = [...ready].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  for (const r of newestFirst) push({ id: r.id, name: r.name, visibility: "private", source: "own" });

  return picked;
}
