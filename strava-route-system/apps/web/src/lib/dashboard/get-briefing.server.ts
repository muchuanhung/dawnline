/**
 * 今日判讀的資料組裝（伺服器端專用）
 * 路線與各行政區天氣平行抓取；同一縣市的 CWB 請求由 fetch 快取去重。
 * 路線清單、CWB 天氣、TDX 事件各自快取 10 分鐘；Dashboard 只判讀畫面上那一條路線。
 */

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

/** 單一公開路線判讀 */
async function briefPublicRoute(routeId: string, trip: TripOptions): Promise<RouteBriefing | null> {
  const route = (await loadRoutes()).find((r) => r.id === routeId);
  if (!route) return null;
  return briefLoadedRoute(route, trip);
}

/**
 * 單一路線判讀（Dashboard、/routes、AI 摘要、預熱排程共用）；與 Dashboard 同一條流程，前端不再自行判定。
 * 不把整份判讀包進 unstable_cache：包在裡面時，路線清單、TDX 事件、CWB fetch 的快取全部會被略過
 * （Next 對巢狀快取一律不讀不寫），每次都要重抓。判讀本身是純計算，靠這些輸入各自的快取就夠快。
 */
export async function getRouteBriefing(routeId: string, trip: TripOptions = {}): Promise<RouteBriefing | null> {
  const started = Date.now();
  const briefing = await briefPublicRoute(routeId, trip);
  // 暫時的計時紀錄（Vercel Logs 搜尋「判讀計時」）；確認變快後移除
  console.info(`[判讀計時] route=${routeId} ${Date.now() - started}ms`);
  return briefing;
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
  const t0 = Date.now();
  // 暫時的分段計時（從開始到各資料回來的時間）；查完就移除
  const lap = (label: string) => <T,>(v: T): T => {
    console.info(`[判讀計時] ${label} ${Date.now() - t0}ms`);
    return v;
  };
  const eventsPromise = getRoadEvents(counties).then(lap(`TDX 事件 ${counties.length} 縣市`)).catch((e) => {
    console.warn("路況事件取得失敗:", e instanceof Error ? e.message : e);
    return null;
  });
  // 即時雨量站每縣市抓一次，再依各路線自己的座標篩 3 km 內測站
  const stationsPromise = Promise.all(
    counties.map(async (c) => [c, await getCountyRainfallStations(c)] as const)
  )
    .then(lap("雨量站"))
    .then((entries) => new Map(entries));
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

  lap(`CWB 天氣 ${keys.length} 行政區`)(null);
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
