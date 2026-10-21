/**
 * 今日判讀的資料組裝（伺服器端專用）
 * 路線與各行政區天氣平行抓取；同一縣市的 CWB 請求由 fetch 快取去重。
 * 單一公開路線的判讀快取 10 分鐘（與 CWB 即時雨量、TDX 事件的快取一致），
 * Dashboard、路線頁判讀 API、AI 摘要與預熱排程共用同一份，不重複計算。
 */

import { unstable_cache } from "next/cache";
import { loadRoutes } from "@/lib/routes/load-routes.server";
import type { Route } from "@/lib/routes/route-data";
import { demoRoadEvents } from "@/lib/routes/demo-route";
import type { Activity } from "@/lib/routes/trip";
import { getCountyRainfallStations, getDistrictWeather } from "@/lib/cwb/district-weather.server";
import { getRoadEvents } from "@/lib/tdx/road-events.server";
import {
  briefRoute,
  mapCwbCondition,
  routeDistrictKeys,
  withRouteObservedRain,
  type DistrictWeather,
  type RouteBriefing,
} from "@/lib/dashboard/briefing";

/** 判讀快取秒數；資料來源本身也是 10 分鐘更新，再短沒有意義 */
const BRIEFING_CACHE_SECONDS = 600;
/** 快取過期後最多再沿用 5 分鐘（背景重算期間），再舊就重算 */
const BRIEFING_MAX_AGE_MS = (BRIEFING_CACHE_SECONDS + 300) * 1000;

/** 行程設定：出發時間與運動類型；未指定為現在、依路線類型 */
export interface TripOptions {
  departure?: Date;
  activity?: Activity;
  /** 途中模式：目前在路線上的里程；只對 getRouteBriefing 的單一路線有意義 */
  fromKm?: number;
}

/** 首頁未登入用：前 N 條路線（loadRoutes 排序）的即時判讀 */
export async function getPublicBriefings(limit = 3): Promise<RouteBriefing[]> {
  const routes = (await loadRoutes()).slice(0, limit);
  if (routes.length === 0) return [];
  return (await briefRoutes(routes)).briefings;
}

/** 單一公開路線判讀，不經快取 */
async function briefPublicRoute(routeId: string, trip: TripOptions): Promise<RouteBriefing | null> {
  const route = (await loadRoutes()).find((r) => r.id === routeId);
  if (!route) return null;
  return briefLoadedRoute(route, trip);
}

/**
 * 快取 key：路線、出發時間（ISO；null 為「現在出發」）、運動類型。
 * 「現在出發」在快取期間沿用計算當下的時間，最多相差 10 分鐘。
 * 連同計算時間一起存，讓 getRouteBriefing 擋下太舊的結果。
 */
const cachedRouteBriefing = unstable_cache(
  async (routeId: string, departureIso: string | null, activity: Activity | null) => ({
    computedAt: Date.now(),
    briefing: await briefPublicRoute(routeId, {
      departure: departureIso ? new Date(departureIso) : undefined,
      activity: activity ?? undefined,
    }),
  }),
  ["route-briefing-v1"],
  { revalidate: BRIEFING_CACHE_SECONDS }
);

/**
 * 單一路線判讀（Dashboard、/routes、AI 摘要、預熱排程共用）；與 Dashboard 同一條流程，前端不再自行判定。
 * 途中模式（fromKm）每次里程都不同，不快取。
 */
export async function getRouteBriefing(routeId: string, trip: TripOptions = {}): Promise<RouteBriefing | null> {
  if (trip.fromKm != null) return briefPublicRoute(routeId, trip);
  const started = Date.now();
  const cached = await cachedRouteBriefing(routeId, trip.departure?.toISOString() ?? null, trip.activity ?? null);
  const ageS = Math.round((Date.now() - cached.computedAt) / 1000);
  // 暫時的計時紀錄（Vercel Logs 搜尋「判讀計時」）：確認快取有沒有命中、慢在哪裡；查完就移除
  console.info(`[判讀計時] route=${routeId} ${Date.now() - started}ms cacheAge=${ageS}s`);
  // unstable_cache 過期後仍會先回舊值、背景再重算；很久沒人看的路線可能拿到幾小時前的判讀，
  // 超過上限就當場重算，不顯示過期判讀（背景重算已由這次讀取觸發）
  if (ageS * 1000 > BRIEFING_MAX_AGE_MS) return briefPublicRoute(routeId, trip);
  return cached.briefing;
}

/**
 * 已解析好的單一路線判讀（私人路線用）：路線不在 loadRoutes 裡，由呼叫端讀取 GPX 後傳入。
 * 判讀流程與公開路線完全相同。
 */
export async function briefLoadedRoute(route: Route, trip: TripOptions = {}): Promise<RouteBriefing | null> {
  return (await briefRoutes([route], trip, route.id)).briefings[0] ?? null;
}

/** suggestFor：只替這條路線試算建議出發時段（畫面只顯示目前路線的建議） */
async function briefRoutes(routes: Route[], trip: TripOptions = {}, suggestFor?: string) {
  const keys = routeDistrictKeys(routes);
  const counties = [...new Set(routes.flatMap((r) => r.segments.map((s) => s.county).filter((c): c is string => !!c)))];
  // 天氣與路況事件平行取得；事件失敗不影響天氣判讀
  const eventsPromise = getRoadEvents(counties).catch((e) => {
    console.warn("路況事件取得失敗:", e instanceof Error ? e.message : e);
    return null;
  });
  // 即時雨量站每縣市抓一次，再依各路線自己的座標篩 3 km 內測站
  const stationsPromise = Promise.all(
    counties.map(async (c) => [c, await getCountyRainfallStations(c)] as const)
  ).then((entries) => new Map(entries));
  const results = await Promise.allSettled(
    keys.map(async (key) => {
      const [county, district] = key.split("|") as [string, string];
      const w = await getDistrictWeather(county, district);
      const first = w.rainfall12h[0];
      const weather: DistrictWeather = {
        rainProbability: first?.pop ?? 0,
        windSpeedKmh: w.windSpeedKmh,
        temperature: w.temperature,
        condition: mapCwbCondition(w.condition),
        periodLabel: first ? `${first.label}–${first.endLabel}` : null,
        rainfallBuckets: w.rainfall12h,
        windBuckets: w.windBuckets,
        stale: w.stale,
      };
      return [key, weather] as const;
    })
  );

  const lookup = new Map<string, DistrictWeather>();
  for (const r of results) {
    if (r.status === "fulfilled") lookup.set(r.value[0], r.value[1]);
    else console.warn("行政區天氣取得失敗:", r.reason instanceof Error ? r.reason.message : r.reason);
  }

  const [eventsResult, stationsByCounty] = await Promise.all([eventsPromise, stationsPromise]);
  const now = new Date();
  const eventsFailed = eventsResult ? eventsResult.failed : null;
  const briefings = routes.map((route) =>
    briefRoute(route, withRouteObservedRain(route, lookup, stationsByCounty), {
      // 示意路線另加假事件；真實路線只看 TDX
      events: route.demo ? [...(eventsResult?.events ?? []), ...demoRoadEvents(route, now)] : (eventsResult?.events ?? []),
      now,
      departure: trip.departure ?? now,
      activity: trip.activity,
      eventsFailed,
      suggest: route.id === suggestFor,
      // 里程只對應這條路線，不能套到其他路線
      fromKm: route.id === suggestFor ? trip.fromKm : undefined,
    })
  );
  return { briefings };
}
