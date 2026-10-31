/**
 * 公開路線（伺服器端專用）：從 FastAPI 後端讀清單與 GPX，解析成 Route。
 * 後端只存檔案與 metadata（MySQL＋S3），解析、行政區取樣、判讀仍在這裡做，與原本 Firebase Storage 來源同一套流程。
 *
 * 路線 id 是後端的 slug（沿用原 GPX 檔名），所以網址、Firestore 判讀輸入、行程設定的 key 都不變。
 * 名稱與類型沿用 GPX 解析結果，與搬家前一致（後端存的 name 只給收藏清單等不讀 GPX 的地方用）。
 */

import { parseGpxPoints, parseGpxToRoute } from "@/lib/routes/parse-gpx";
import { getSegmentsFromPoints } from "@/lib/routes/geocode-districts";
import type { Route } from "@/lib/routes/route-data";

/** GET /api/v1/public-routes 的每一筆 */
export interface PublicRouteMeta {
  id: string;
  name: string;
  type: string;
  distanceKm: number | null;
  elevationGainM: number | null;
  updatedAt: string;
}

function backendBase(): string | null {
  return process.env.BACKEND_API_URL?.replace(/\/+$/, "") || null;
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`後端 ${res.status}：${url}`);
  return (await res.json()) as T;
}

/** 讀一條公開路線的 GPX 並解析；失敗回 null（單條壞掉不影響其他路線，與 Storage 來源相同） */
async function loadOne(base: string, meta: PublicRouteMeta): Promise<Route | null> {
  try {
    const { url } = await getJson<{ url: string }>(
      `${base}/api/v1/public-routes/${encodeURIComponent(meta.id)}/gpx`
    );
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`S3 ${res.status}`);
    const xml = await res.text();
    const { points } = parseGpxPoints(xml);
    return parseGpxToRoute(xml, meta.id, getSegmentsFromPoints(points));
  } catch (err) {
    console.warn(`無法讀取公開路線 ${meta.id}:`, err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * 全部公開路線（依名稱排序）。
 * - 未設定 BACKEND_API_URL 回 null，代表「沒有後端來源」，由呼叫端決定退回哪裡；
 * - 清單讀取失敗直接丟錯；個別 GPX 失敗只略過那一條。
 */
export async function fetchPublicRoutesFromBackend(): Promise<Route[] | null> {
  const base = backendBase();
  if (!base) return null;
  const { routes } = await getJson<{ routes: PublicRouteMeta[] }>(`${base}/api/v1/public-routes`);
  const parsed = await Promise.all(routes.map((meta) => loadOne(base, meta)));
  return parsed.filter((r): r is Route => r !== null).sort((a, b) => a.name.localeCompare(b.name));
}

export type PublicRoutesLoader = {
  backend: () => Promise<Route[] | null>;
  storage: () => Promise<Route[]>;
};

/**
 * 後端優先，失敗才讀 Storage；兩邊都失敗時丟出 Storage 的錯誤（由 loadRoutes 收成只剩示意路線）。
 * 後端回空清單也退回 Storage：公開路線尚未匯入時不會整個清單消失。
 */
export async function loadPublicRoutesWithFallback(loader: PublicRoutesLoader): Promise<Route[]> {
  try {
    const routes = await loader.backend();
    if (routes && routes.length > 0) return routes;
    if (routes) console.warn("後端公開路線是空的，改讀 Firebase Storage");
  } catch (err) {
    console.warn("後端公開路線讀取失敗，改讀 Firebase Storage:", err instanceof Error ? err.message : err);
  }
  return loader.storage();
}
