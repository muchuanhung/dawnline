/**
 * 今日判讀的資料組裝（伺服器端專用）
 * 外部資料（CWB 行政區天氣、縣市雨量站、TDX 事件）先讀 Firestore 裡的判讀輸入，
 * 缺或過期才當場抓並寫回；Inngest 每 10 分鐘把公開路線用到的輸入全部更新一次。
 * Dashboard 只判讀畫面上那一條路線。
 */

import { loadRoutes } from "@/lib/routes/load-routes.server";
import type { Route } from "@/lib/routes/route-data";
import { demoRoadEvents } from "@/lib/routes/demo-route";
import type { RoadEvent } from "@/lib/routes/road-events";
import type { Activity } from "@/lib/routes/trip";
import type { StationRain } from "@/lib/cwb/rainfall-stations";
import { normalizeCountyForCWB } from "@/lib/cwb/county-map";
import { getCountyRainfallStations, getDistrictWeather } from "@/lib/cwb/district-weather.server";
import { tdxCityCode } from "@/lib/tdx/client";
import { getRoadEventsByCounty, type RoadEventsResult } from "@/lib/tdx/road-events.server";
import { readBriefingInputs, writeBriefingInputs } from "@/lib/background/briefing-inputs.firestore";
import { freshInputs, inputId, type StoredInput } from "@/lib/dashboard/briefing-inputs";
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
 * 不把整份判讀包進 unstable_cache：包在裡面時，裡面的快取與 fetch 快取全部會被略過（Next 對巢狀快取一律不讀不寫）。
 * 判讀本身是純計算，外部資料由 loadBriefingInputs 從 Firestore 取得。
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

const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** CWB 回應轉成判讀用的行政區天氣（存進判讀輸入的也是這份，比原始回應小） */
function toDistrictWeather(w: Awaited<ReturnType<typeof getDistrictWeather>>): DistrictWeather {
  const first = w.rainfall12h[0];
  return {
    rainProbability: first?.pop ?? 0,
    windSpeedKmh: w.windSpeedKmh,
    temperature: w.temperature,
    condition: mapCwbCondition(w.condition),
    periodLabel: first ? `${first.label}–${first.endLabel}` : null,
    rainfallBuckets: w.rainfall12h,
    windBuckets: w.windBuckets,
    stale: w.stale,
  };
}

/**
 * 判讀需要的外部資料。先一次讀出 Firestore 裡的判讀輸入，缺或過期的才當場向 CWB／TDX 抓，抓到的寫回。
 * 取不到的資料一律缺席（天氣不進 lookup、事件縣市列入 failed），由判讀改判 unknown，不當成安全。
 * force：排程更新用，不讀 Firestore、全部重抓。
 */
async function loadBriefingInputs(routes: Route[], { force = false } = {}) {
  const keys = routeDistrictKeys(routes);
  const counties = [...new Set(routes.flatMap((r) => r.segments.map((s) => s.county).filter((c): c is string => !!c)))];
  // TDX 以正式縣市名存放（台北縣、新北市同一份）；查無 TDX 代碼的縣市本來就不抓
  const tdxCounties = [...new Set(counties.filter((c) => tdxCityCode(c)).map(normalizeCountyForCWB))];
  const ids = [
    ...keys.map((k) => inputId("weather", k)),
    ...counties.map((c) => inputId("rain", c)),
    ...tdxCounties.map((c) => inputId("tdx", c)),
  ];

  const started = Date.now();
  let stored = new Map<string, StoredInput>();
  if (!force) {
    try {
      stored = await readBriefingInputs(ids);
    } catch (e) {
      console.warn("判讀輸入讀取失敗，改為即時抓取:", errorMessage(e));
    }
  }
  const { fresh, missing } = freshInputs(stored, ids, Date.now());
  const toWrite: { id: string; data: unknown; fetchedAt: number }[] = [];
  const save = (id: string, data: unknown) => toWrite.push({ id, data, fetchedAt: Date.now() });

  // TDX：只抓缺的縣市（依序、限流就停）；整個服務失敗回 null，判讀視為事件取不到
  const eventsPromise = (async (): Promise<RoadEventsResult | null> => {
    const events: RoadEvent[] = [];
    const missingCounties: string[] = [];
    for (const c of tdxCounties) {
      const stored = fresh.get(inputId("tdx", c));
      // 形狀不對就當作沒有，重抓；不可當成「沒有事件」
      if (Array.isArray(stored)) events.push(...(stored as RoadEvent[]));
      else missingCounties.push(c);
    }
    if (missingCounties.length === 0) return { events, failed: [] };
    try {
      const live = await getRoadEventsByCounty(missingCounties);
      for (const [c, list] of live.byCounty) {
        save(inputId("tdx", c), list);
        events.push(...list);
      }
      return { events, failed: live.failed };
    } catch (e) {
      console.warn("路況事件取得失敗:", errorMessage(e));
      return null;
    }
  })();

  // 即時雨量站每縣市一份，再依各路線自己的座標篩 3 km 內測站；取不到（null）不存
  const stationsPromise = Promise.all(
    counties.map(async (c) => {
      const id = inputId("rain", c);
      const stored = fresh.get(id);
      if (Array.isArray(stored)) return [c, stored as StationRain[]] as const;
      const stations = await getCountyRainfallStations(c);
      if (stations) save(id, stations);
      return [c, stations] as const;
    })
  ).then((entries) => new Map(entries));

  const weatherResults = await Promise.allSettled(
    keys.map(async (key) => {
      const id = inputId("weather", key);
      const stored = fresh.get(id);
      if (stored && typeof stored === "object") return [key, stored as DistrictWeather] as const;
      const [county, district] = key.split("|") as [string, string];
      const weather = toDistrictWeather(await getDistrictWeather(county, district));
      save(id, weather);
      return [key, weather] as const;
    })
  );
  const lookup = new Map<string, DistrictWeather>();
  for (const r of weatherResults) {
    if (r.status === "fulfilled") lookup.set(r.value[0], r.value[1]);
    else console.warn("行政區天氣取得失敗:", errorMessage(r.reason));
  }
  const [eventsResult, stationsByCounty] = await Promise.all([eventsPromise, stationsPromise]);

  try {
    await writeBriefingInputs(toWrite);
  } catch (e) {
    // 寫回失敗只影響下次速度，不影響這次判讀
    console.warn("判讀輸入寫回失敗:", errorMessage(e));
  }
  // 暫時的計時紀錄（Vercel Logs 搜尋「判讀計時」）；確認變快後移除
  const unsaved = missing.filter((id) => !toWrite.some((w) => w.id === id));
  console.info(
    `[判讀計時] 輸入 ${ids.length} 項，重抓 ${missing.length} 項 ${Date.now() - started}ms` +
      (missing.length ? ` 重抓=${missing.join(",")}` : "") +
      (unsaved.length ? ` 未存=${unsaved.join(",")}` : "")
  );
  return { lookup, eventsResult, stationsByCounty, refetched: missing.length, total: ids.length };
}

/**
 * 排程用：重抓所有公開路線用到的判讀輸入並寫入 Firestore，使用者請求就不必再打 CWB／TDX。
 * 回傳筆數供 Inngest 顯示。
 */
export async function refreshBriefingInputs(): Promise<{ inputs: number; eventsFailed: string[] | null }> {
  const { total, eventsResult } = await loadBriefingInputs(await loadRoutes(), { force: true });
  return { inputs: total, eventsFailed: eventsResult ? eventsResult.failed : null };
}

/** suggestFor：只替這條路線試算建議出發時段（畫面只顯示目前路線的建議） */
async function briefRoutes(routes: Route[], trip: TripOptions = {}, suggestFor?: string) {
  const { lookup, eventsResult, stationsByCounty } = await loadBriefingInputs(routes);
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
