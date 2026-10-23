/**
 * Dashboard 今日判讀的資料組裝（伺服器端專用）
 * 路線與各行政區天氣平行抓取；同一縣市的 CWB 請求由 fetch 快取去重。
 */

import { loadRoutes } from "@/lib/routes/load-routes.server";
import type { Route } from "@/lib/routes/route-data";
import { demoRoadEvents } from "@/lib/routes/demo-route";
import type { Activity } from "@/lib/routes/trip";
import { getCountyRainfallStations, getDistrictWeather } from "@/lib/cwb/district-weather.server";
import { getRoadEvents } from "@/lib/tdx/road-events.server";
import { reportError, reportFailureRate } from "@/lib/observability/report";
import {
  briefRoute,
  mapCwbCondition,
  routeDistrictKeys,
  withRouteObservedRain,
  type DistrictWeather,
  type RouteBriefing,
} from "@/lib/dashboard/briefing";

export type DashboardBriefing =
  | { status: "no-routes" }
  | {
      status: "ok";
      featured: RouteBriefing;
      routes: { id: string; name: string }[];
      /** 有天氣資料的行政區數 / 總數 */
      weatherCoverage: { ok: number; total: number };
      /** 路況事件取不到的縣市；null 代表整個事件服務失敗 */
      eventsFailed: string[] | null;
    };

/** 行程設定：出發時間與運動類型；未指定為現在、依路線類型 */
export interface TripOptions {
  departure?: Date;
  activity?: Activity;
  /** 途中模式：目前在路線上的里程；只對 getRouteBriefing 的單一路線有意義 */
  fromKm?: number;
}

export async function getDashboardBriefing(routeId?: string, trip: TripOptions = {}): Promise<DashboardBriefing> {
  const routes = await loadRoutes();
  if (routes.length === 0) return { status: "no-routes" };
  // 目前要看的路線排最前面：TDX 限流時優先抓到它經過縣市的路況事件
  const current = routes.find((r) => r.id === routeId) ?? routes[0]!;
  const { briefings, weatherCoverage, eventsFailed } = await briefRoutes(
    [current, ...routes.filter((r) => r !== current)],
    trip,
    current.id
  );
  const featured = briefings.find((b) => b.id === routeId) ?? briefings[0]!;

  return {
    status: "ok",
    featured,
    // 切換列維持原本路線順序（判讀時為了抓取優先順序重排過）
    routes: routes.flatMap((r) => briefings.filter((b) => b.id === r.id).map((b) => ({ id: b.id, name: b.name }))),
    weatherCoverage,
    eventsFailed,
  };
}

/** 首頁未登入用：前 N 條路線（loadRoutes 排序）的即時判讀 */
export async function getPublicBriefings(limit = 3): Promise<RouteBriefing[]> {
  const routes = (await loadRoutes()).slice(0, limit);
  if (routes.length === 0) return [];
  return (await briefRoutes(routes)).briefings;
}

/** 單一路線判讀（/routes 與 lab 頁用）；與 Dashboard 同一條流程，前端不再自行判定 */
export async function getRouteBriefing(routeId: string, trip: TripOptions = {}): Promise<RouteBriefing | null> {
  const route = (await loadRoutes()).find((r) => r.id === routeId);
  if (!route) return null;
  return briefLoadedRoute(route, trip);
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
    reportError("tdx", "road-events-unavailable", e, { counties: counties.length });
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
    else reportError("cwb", "district-weather-failed", r.reason);
  }
  // 失敗率告警：單一行政區失敗是常態，整批拿不到代表 CWB 或金鑰出事
  reportFailureRate("cwb", "district-weather-degraded", lookup.size, keys.length);

  const [eventsResult, stationsByCounty] = await Promise.all([eventsPromise, stationsPromise]);
  const now = new Date();
  const eventsFailed = eventsResult ? eventsResult.failed : null;
  if (eventsResult && counties.length) {
    reportFailureRate("tdx", "road-events-degraded", counties.length - eventsResult.failed.length, counties.length);
  }
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
  return { briefings, weatherCoverage: { ok: lookup.size, total: keys.length }, eventsFailed };
}
