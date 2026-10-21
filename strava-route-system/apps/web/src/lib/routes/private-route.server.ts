/**
 * 私人路線（伺服器端專用）：代替使用者向 FastAPI 後端讀取路線與 GPX，解析成 Route 給判讀用。
 * 帶上使用者自己的 cookie（rc_session）呼叫後端，權限仍由後端判斷：別人的路線一律 404。
 */

import { parseGpxPoints, parseGpxToRoute } from "@/lib/routes/parse-gpx";
import { getSegmentsFromPoints } from "@/lib/routes/geocode-districts";
import type { Route } from "@/lib/routes/route-data";
import type { PrivateRoute, PrivateRouteList } from "@/lib/routes/private-routes";

/**
 * 解析後 GPX 的快取（private-gpx-cache.server.ts 提供）；未傳入時每次都重新讀取。
 * 同一個 id 的 GPX 不會變（重新上傳會拿到新 id），名稱與類型每次仍以後端為準。
 */
export type ParsedGpxCache = (routeId: string, load: () => Promise<Route>) => Promise<Route>;

/** 後端路線 id 是 ULID；先擋掉其他格式，避免拼進後端網址 */
const ROUTE_ID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/i;

/** status 對應 API 回應碼：401 後端 session 過期、404 找不到或不是自己的、503 後端未設定或連不上 */
export class PrivateRouteError extends Error {
  constructor(
    readonly status: 401 | 404 | 502 | 503,
    message: string
  ) {
    super(message);
  }
}

function backendBase(): string {
  const base = process.env.BACKEND_API_URL?.replace(/\/+$/, "");
  if (!base) throw new PrivateRouteError(503, "後端未設定");
  return base;
}

async function backendJson<T>(path: string, cookie: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${backendBase()}/api/v1/routes${path}`, { headers: { cookie }, cache: "no-store" });
  } catch {
    throw new PrivateRouteError(503, "後端連不上");
  }
  if (res.status === 401) throw new PrivateRouteError(401, "請重新登入");
  if (res.status === 404) throw new PrivateRouteError(404, "找不到路線");
  if (!res.ok) throw new PrivateRouteError(502, `後端錯誤 ${res.status}`);
  return (await res.json()) as T;
}

/**
 * 讀取一條私人路線：
 * 1. 列表找 metadata（每人最多 10 條，後端沒有單筆查詢端點）
 * 2. 拿短效下載網址，伺服器端直接從 S3 讀 GPX（不經瀏覽器，不需要 S3 GET 的 CORS）
 * 3. 與公開路線同一套解析與行政區取樣；名稱與類型以後端資料庫為準
 */
export async function loadPrivateRoute(
  routeId: string,
  cookie: string,
  cache: ParsedGpxCache = (_id, load) => load()
): Promise<Route> {
  if (!ROUTE_ID_PATTERN.test(routeId)) throw new PrivateRouteError(404, "找不到路線");

  const { routes } = await backendJson<PrivateRouteList>("", cookie);
  const meta: PrivateRoute | undefined = routes.find((r) => r.id === routeId);
  if (!meta || meta.status !== "ready") throw new PrivateRouteError(404, "找不到路線");

  // 權限已由上面的列表確認；快取 key 只用 routeId，未命中時才拿下載網址、讀 S3、取樣行政區
  const route = await cache(routeId, () => fetchParsedGpx(routeId, cookie));
  return { ...route, name: meta.name, nameZh: meta.name, type: meta.type as Route["type"] };
}

/** 從 S3 讀 GPX 並解析（含行政區取樣，最花時間的一步） */
async function fetchParsedGpx(routeId: string, cookie: string): Promise<Route> {
  const { url } = await backendJson<{ url: string }>(`/${routeId}/gpx`, cookie);
  let xml: string;
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`S3 ${res.status}`);
    xml = await res.text();
  } catch (err) {
    console.warn("私人路線 GPX 讀取失敗:", err instanceof Error ? err.message : err);
    throw new PrivateRouteError(502, "路線檔案讀取失敗");
  }

  const { points } = parseGpxPoints(xml);
  return parseGpxToRoute(xml, routeId, getSegmentsFromPoints(points));
}
