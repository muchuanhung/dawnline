/**
 * 收藏（需登入）：呼叫 FastAPI 後端 /api/v1/favorites。
 * 路線 id 與其他 API 相同：公開路線是 slug（= Route.id），私人路線是 ULID（= /routes/private/[id]）。
 * PUT／DELETE 在後端是冪等的，所以前端可以先改畫面（樂觀更新），失敗再改回來。
 */

import { BackendError, request } from "@/lib/routes/private-routes";

export interface FavoriteItem {
  id: string;
  visibility: "public" | "private";
  name: string;
  createdAt: string;
}

export interface FavoriteList {
  favorites: FavoriteItem[];
  limit: number;
}

const API_BASE = "/api/v1/favorites";

export function listFavorites(): Promise<FavoriteList> {
  return request<FavoriteList>("", undefined, API_BASE);
}

export function addFavorite(id: string): Promise<void> {
  return request<void>(`/${encodeURIComponent(id)}`, { method: "PUT" }, API_BASE);
}

export function removeFavorite(id: string): Promise<void> {
  return request<void>(`/${encodeURIComponent(id)}`, { method: "DELETE" }, API_BASE);
}

/** 樂觀更新用：加入時放最前面（與後端新收藏在前一致），移除時拿掉；不重複 */
export function applyFavorite(ids: readonly string[], id: string, on: boolean): string[] {
  const rest = ids.filter((x) => x !== id);
  return on ? [id, ...rest] : rest;
}

/** 收藏失敗時給使用者看的一句話 */
export function favoriteErrorMessage(err: unknown, limit: number | null): string {
  if (!(err instanceof BackendError)) return "收藏失敗，請再試一次";
  if (err.code === "favorite_limit_reached") return limit ? `最多收藏 ${limit} 條路線` : "收藏已達上限";
  if (err.status === 0) return "網路連線中斷，收藏沒有更新";
  if (err.status === 401) return "登入已過期，請重新登入";
  if (err.status === 404) return "找不到這條路線";
  return "收藏失敗，請再試一次";
}
