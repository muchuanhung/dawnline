/**
 * TDX 即時道路事件（伺服器端專用）
 * /v1/Traffic/RoadEvent/LiveEvent/City/{City}：帶 POINT 座標，可對應到路線。
 *
 * TDX 限流很嚴（實測連續 6 次就 429），因此（與 CCTV 抓取同一做法）：
 * - 每個縣市結果快取 10 分鐘（失敗不快取，下次重試）
 * - 多個縣市依序請求，不並發；實際打到 TDX 的請求之間至少隔 500ms（快取命中不等）
 * - 遇到 429 等 5 秒重試一次；仍被限流就不再打後面的縣市，其餘標為取不到，避免整頁卡住
 */

import { unstable_cache } from "next/cache";
import { getAccessToken, tdxCityCode } from "@/lib/tdx/client";
import { normalizeCountyForCWB } from "@/lib/cwb/county-map";
import { parseTdxEvent, type RoadEvent } from "@/lib/routes/road-events";

const EVENT_BASE = "https://tdx.transportdata.tw/api/basic/v1/Traffic/RoadEvent/LiveEvent/City";
const REQUEST_TIMEOUT_MS = 6000;
const MIN_GAP_MS = 500;
const RATE_LIMIT_WAIT_MS = 5000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 被限流且重試仍失敗；呼叫端據此停止打後面的縣市 */
class RateLimitedError extends Error {
  override name = "RateLimitedError";
}

let lastRequestAt = 0;

/** 實際打到 TDX 前確保與上一個請求至少隔 MIN_GAP_MS */
async function throttledFetch(url: string, token: string): Promise<Response> {
  const wait = lastRequestAt + MIN_GAP_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastRequestAt = Date.now();
  return fetch(url, {
    headers: { Authorization: `Bearer ${token}`, "Accept-Encoding": "gzip, br" },
    cache: "no-store",
    // 網路卡住時不可拖住整頁判讀；逾時視為該縣市取不到
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
}

async function fetchCityEventsUncached(cityCode: string): Promise<RoadEvent[]> {
  const token = await getAccessToken();
  const url = `${EVENT_BASE}/${cityCode}?$format=JSON`;
  let res = await throttledFetch(url, token);
  if (res.status === 429) {
    console.warn(`[TDX] 路況事件速率限制 ${cityCode}，等候 5 秒後重試`);
    await sleep(RATE_LIMIT_WAIT_MS);
    res = await throttledFetch(url, token);
    if (res.status === 429) throw new RateLimitedError(`TDX 路況事件重試後仍被限流 ${cityCode}`);
  }
  if (!res.ok) throw new Error(`TDX 路況事件取得失敗 ${cityCode}: ${res.status}`);
  const data: unknown = await res.json();
  const list = Array.isArray(data)
    ? data
    : (Object.values((data ?? {}) as Record<string, unknown>).find(Array.isArray) ?? []);
  return (list as Parameters<typeof parseTdxEvent>[0][]).map(parseTdxEvent).filter((e): e is RoadEvent => e !== null);
}

const fetchCityEvents = (cityCode: string) =>
  unstable_cache(() => fetchCityEventsUncached(cityCode), ["tdx-road-events", cityCode], {
    revalidate: 600,
    tags: ["tdx-road-events"],
  })();

export interface RoadEventsResult {
  events: RoadEvent[];
  /** 取不到資料的縣市（顯示「暫時取不到」，不可當成沒有事件） */
  failed: string[];
}

/** 各縣市分開的事件（key 為正式縣市名），供判讀輸入逐縣市存放 */
export interface CountyRoadEvents {
  byCounty: Map<string, RoadEvent[]>;
  /** 取不到資料的縣市（顯示「暫時取不到」，不可當成沒有事件） */
  failed: string[];
}

/**
 * 依路段縣市（可為舊名）逐縣市取得事件；查無 TDX 代碼的縣市略過（不算失敗）。
 * 依傳入順序抓取，呼叫端把目前要看的路線經過的縣市排在前面，限流時優先保住它們。
 * 縣市名一律回傳正式名（例：台北縣 → 新北市），畫面直接顯示。
 */
export async function getRoadEventsByCounty(counties: string[]): Promise<CountyRoadEvents> {
  const byCode = new Map<string, string>();
  for (const county of counties) {
    const code = tdxCityCode(county);
    if (code && !byCode.has(code)) byCode.set(code, normalizeCountyForCWB(county));
  }

  const byCounty = new Map<string, RoadEvent[]>();
  const failed: string[] = [];
  let rateLimited = false;
  for (const [code, county] of byCode) {
    if (rateLimited) {
      failed.push(county);
      continue;
    }
    try {
      byCounty.set(county, await fetchCityEvents(code));
    } catch (e) {
      console.warn("[TDX] 路況事件取得失敗:", county, e instanceof Error ? e.message : e);
      failed.push(county);
      // 經過 unstable_cache 包裝後以 name 判斷較保險
      if (e instanceof Error && e.name === "RateLimitedError") rateLimited = true;
    }
  }
  return { byCounty, failed };
}
