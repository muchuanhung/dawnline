/**
 * Dashboard「今日判讀」的純函式：天氣合併、判定、替代路線
 * 不依賴 React 與伺服器，可單元測試。
 *
 * 判定原則：今日判讀只看「今天的條件」（降雨、風、雷雨，以及路況事件中的災害、事故、管制、天氣、異常告警）；
 * 施工與壅塞只列出不影響判讀；陡坡是路線固定的特性，不列入示警也不影響判讀，
 * 否則陡的路線天天都是危險，示警會失去可信度。
 */

import type { Route, RouteSegment } from "@/lib/routes/route-data";
import { eventHazards, matchEventsToRoute, type RoadEvent, type RouteEvent } from "@/lib/routes/road-events";
import {
  buildRoutePolylineKm,
  clipRouteFrom,
  clipStagesFrom,
  computeHazards,
  deriveStages,
  isWeatherHazard,
  routeTotalKm,
  summarizeVerdict,
  type Hazard,
  type HazardLevel,
  type ReconVerdict,
  type VerdictLevel,
} from "@/lib/routes/recon-geo";
import { normalizeCountyForCWB } from "@/lib/cwb/county-map";
import { ACTIVITY, activityOfRouteType, formatClock, paceFor, type Activity } from "@/lib/routes/trip";
import { summarizeRainfall, type LatLon, type StationRain } from "@/lib/cwb/rainfall-stations";
import {
  DEFAULT_CYCLING_SPEED_KMH,
  departureForPosition,
  estimateArrivalTime,
  isBeyondForecast,
  pickRainfallBucketForSegment,
  pickWindForSegment,
  type Pace,
  type RainfallBucket,
  type WindBucket,
} from "@/lib/cwb/forecast-eta";

export interface DistrictWeather {
  /** 第一個預報時段的降雨機率；沒有 rainfallBuckets 或未指定出發時間時使用 */
  rainProbability: number;
  windSpeedKmh: number;
  temperature: number;
  condition: RouteSegment["condition"];
  /** 第一個預報時段（台灣時間標籤） */
  periodLabel: string | null;
  /** 完整降雨機率時段，依各路段 ETA 挑選 */
  rainfallBuckets?: RainfallBucket[];
  /** 風速時段，依各路段 ETA 挑選；沒有時用 windSpeedKmh（第一個時段） */
  windBuckets?: WindBucket[];
  /** 路線 3 km 內雨量站的即時時雨量（mm/hr）；null 為附近沒有測站，未提供時不列入判定 */
  observedRainMmPerHr?: number | null;
  /** 重抓後仍是過期預報 */
  stale?: boolean;
}

export type WeatherLookup = ReadonlyMap<string, DistrictWeather>;

export const districtKey = (county: string, district: string) => `${county}|${district}`;

const weatherOf = (seg: RouteSegment, lookup: WeatherLookup) =>
  seg.county && seg.districtZh ? lookup.get(districtKey(seg.county, seg.districtZh)) : undefined;

/** 路段騎經時間所落在的降雨時段；沒有出發時間或時段資料時回傳 null */
function isOutOfCoverage(
  seg: RouteSegment,
  w: DistrictWeather,
  { departureTime, pace = DEFAULT_CYCLING_SPEED_KMH }: ApplyWeatherOptions
): boolean {
  if (!departureTime || !w.rainfallBuckets?.length) return false;
  return isBeyondForecast(seg.sampleKms, departureTime, w.rainfallBuckets, pace);
}

function bucketForSegment(
  seg: RouteSegment,
  w: DistrictWeather,
  { departureTime, pace = DEFAULT_CYCLING_SPEED_KMH }: ApplyWeatherOptions
): RainfallBucket | null {
  if (!departureTime || !w.rainfallBuckets?.length) return null;
  return pickRainfallBucketForSegment(seg.sampleKms, departureTime, w.rainfallBuckets, pace);
}

/** 路段行經時間的風速（km/h）；沒有出發時間或風速時段時退回第一個時段 */
function windForSegment(
  seg: RouteSegment,
  w: DistrictWeather,
  { departureTime, pace = DEFAULT_CYCLING_SPEED_KMH }: ApplyWeatherOptions
): number {
  if (!departureTime || !w.windBuckets?.length) return w.windSpeedKmh;
  return pickWindForSegment(seg.sampleKms, departureTime, w.windBuckets, pace) ?? w.windSpeedKmh;
}

/** CWB condition → 路段 condition */
export function mapCwbCondition(c: string): RouteSegment["condition"] {
  if (c === "sunny") return "clear";
  if (c === "rainy" || c === "stormy" || c === "cloudy") return c;
  return "cloudy";
}

/** 路線涵蓋的所有行政區鍵（去重） */
export function routeDistrictKeys(routes: Route[]): string[] {
  const keys = new Set<string>();
  for (const r of routes) {
    for (const s of r.segments) if (s.county && s.districtZh) keys.add(districtKey(s.county, s.districtZh));
  }
  return [...keys];
}

/**
 * 各行政區在路線上的取樣座標（依 sampleKms 對到 polyline 上最近里程的點），
 * 供即時雨量只採路線 3 km 內測站。多條路線經過同一區時合併。
 */
export function routeDistrictPoints(routes: Route[]): Map<string, LatLon[]> {
  const out = new Map<string, LatLon[]>();
  for (const route of routes) {
    const poly = buildRoutePolylineKm(route);
    if (!poly) continue;
    for (const seg of route.segments) {
      if (!seg.county || !seg.districtZh || !seg.sampleKms?.length) continue;
      const key = districtKey(seg.county, seg.districtZh);
      const points = out.get(key) ?? [];
      for (const km of seg.sampleKms) {
        const i = nearestIndex(poly.cumulativeKm, km);
        const [lat, lon] = poly.points[i]!;
        points.push({ lat, lon });
      }
      out.set(key, points);
    }
  }
  return out;
}

/**
 * 此路線專用的天氣查詢表：即時雨量只採「這條路線」經過各行政區的座標 3 km 內測站，
 * 避免同區其他路線旁的雨影響本路線。縣市測站取不到或附近沒有測站時為 null。
 */
export function withRouteObservedRain(
  route: Route,
  lookup: WeatherLookup,
  stationsByCounty: ReadonlyMap<string, StationRain[] | null>
): WeatherLookup {
  const points = routeDistrictPoints([route]);
  const out = new Map(lookup);
  for (const [key, near] of points) {
    const w = lookup.get(key);
    if (!w) continue;
    const stations = stationsByCounty.get(key.split("|")[0]!);
    const rain = stations ? summarizeRainfall(stations, near) : null;
    out.set(key, { ...w, observedRainMmPerHr: rain?.scope === "nearby" ? rain.mmPerHr : null });
  }
  return out;
}

/** 遞增陣列中最接近 target 的索引 */
function nearestIndex(sorted: number[], target: number): number {
  let lo = 0;
  let hi = sorted.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid]! < target) lo = mid + 1;
    else hi = mid;
  }
  return lo > 0 && Math.abs(sorted[lo - 1]! - target) <= Math.abs(sorted[lo]! - target) ? lo - 1 : lo;
}

export interface ApplyWeatherOptions {
  /** 出發時間；提供時各路段的降雨機率、風速改用其 ETA 所在的時段 */
  departureTime?: Date;
  /** 行進速度（均速或依爬升修正的耗時函式），預設自行車均速 */
  pace?: Pace;
}

/**
 * 把天氣合併進路段；查不到的路段標 hasWeather=false（數值不可當真）。
 * 風速、氣溫、天氣現象仍是第一個預報時段（CWB 這些欄位目前只取第一筆）。
 */
export function applyWeather(route: Route, lookup: WeatherLookup, options: ApplyWeatherOptions = {}): Route {
  return {
    ...route,
    segments: route.segments.map((seg) => {
      const w = weatherOf(seg, lookup);
      if (!w) return { ...seg, hasWeather: false };
      return {
        ...seg,
        rainProbability: bucketForSegment(seg, w, options)?.pop ?? w.rainProbability,
        windSpeed: windForSegment(seg, w, options),
        temperature: w.temperature,
        condition: w.condition,
        hasWeather: true,
        observedRainMmPerHr: w.observedRainMmPerHr,
        weatherStale: w.stale ?? false,
        outOfCoverage: isOutOfCoverage(seg, w, options),
      };
    }),
  };
}

/** 路段進入時間在現在起幾分鐘內才參考即時雨量 */
const OBSERVED_RAIN_RELEVANT_MIN = 60;

/**
 * 即時雨量是「現在」的實測，只對快要抵達的路段有意義：逐段以進入 ETA 判斷，
 * 現在起 60 分鐘內進入的路段採用，較晚抵達的路段只看預報。
 * 途中模式反推的出發時間在現在之前，前方近處的路段 ETA 仍在 60 分鐘內。
 */
function withObservedRainFor(
  route: Route,
  { departureTime, pace = DEFAULT_CYCLING_SPEED_KMH }: ApplyWeatherOptions & { departureTime: Date },
  now: Date
): Route {
  const cutoff = now.getTime() + OBSERVED_RAIN_RELEVANT_MIN * 60_000;
  return {
    ...route,
    segments: route.segments.map((s) => {
      const entryKm = s.sampleKms?.[0];
      if (s.observedRainMmPerHr === undefined || entryKm === undefined) return s;
      if (estimateArrivalTime(entryKm, departureTime, pace).getTime() <= cutoff) return s;
      return { ...s, observedRainMmPerHr: undefined };
    }),
  };
}

/**
 * 判讀實際用到的預報時段：各路段 ETA 時段的最早開始到最晚結束；沒有時段資料時退回第一個路段的時段。
 * 起訖不在 now 的同一天時加「明日」或日期，避免跨日時段顯示成「18:00–18:00」；迄與起同一天時只寫時分。
 */
function usedPeriodLabel(route: Route, lookup: WeatherLookup, options: ApplyWeatherOptions, now: Date): string | null {
  const used: RainfallBucket[] = [];
  let fallback: string | null = null;
  for (const seg of route.segments) {
    const w = weatherOf(seg, lookup);
    if (!w) continue;
    fallback ??= w.periodLabel;
    const bucket = bucketForSegment(seg, w, options);
    if (bucket) used.push(bucket);
  }
  if (used.length === 0) return fallback;
  const first = used.reduce((a, b) => (Date.parse(b.startTime) < Date.parse(a.startTime) ? b : a));
  const last = used.reduce((a, b) => (Date.parse(b.endTime) > Date.parse(a.endTime) ? b : a));
  const from = formatClock(new Date(first.startTime), now), to = formatClock(new Date(last.endTime), now);
  // formatClock 跨日時為「明日 HH:MM」或「MM/DD HH:MM」；迄與起同一天時省略日期
  const day = (label: string) => label.slice(0, Math.max(0, label.lastIndexOf(" ")));
  return `${from}–${day(from) === day(to) ? to.slice(to.lastIndexOf(" ") + 1) : to}`;
}

/** 只保留此路線經過的縣市（事件失敗清單是所有路線共用的） */
function failedOnRoute(route: Route, eventsFailed: string[] | null | undefined): string[] | null | undefined {
  if (!eventsFailed) return eventsFailed;
  const onRoute = new Set(route.segments.map((s) => (s.county ? normalizeCountyForCWB(s.county) : "")));
  return eventsFailed.filter((c) => onRoute.has(normalizeCountyForCWB(c)));
}

export interface RouteBriefing {
  id: string;
  name: string;
  distanceKm: number;
  elevationGainM: number;
  /** 今日判讀：天氣＋影響判定的路況事件 */
  verdict: ReconVerdict;
  /** 影響判定的示警，依里程排序 */
  hazards: Hazard[];
  /** 沿途路況事件（含不影響判定的施工、壅塞、例行維護） */
  roadEvents: RouteEvent[];
  maxRain: number | null;
  maxWindKmh: number | null;
  temperature: { min: number; max: number } | null;
  periodLabel: string | null;
  elevationProfile: [number, number][];
  /** 合併天氣後的路段（含 hasWeather／weatherStale／outOfCoverage），/routes 頁的高程圖與示警用 */
  segments: RouteSegment[];
  /** 此路線經過、路況事件取不到的縣市；null 代表整個事件服務失敗 */
  eventsFailed: string[] | null;
  /** 未來 12 小時內天氣最佳的出發時段；天氣資料不足以比較時為 null */
  departureSuggestion: DepartureSuggestion | null;
  /** 估算各段 ETA 用的出發時間（ISO）與運動類型、均速；畫面用同一組數字顯示預估到達時間 */
  departure: string;
  activity: Activity;
  speedKmh: number;
  /** 這條路線依類型的預設運動類型（未指定 activity 時採用） */
  defaultActivity: Activity;
  /** 示意路線：沿途路況事件為假資料，畫面需標示 */
  demo: boolean;
  /** 途中模式：判讀起點的里程（目前位置）；null 為從起點出發的整條路線判讀 */
  fromKm: number | null;
  /** 這份判讀依據的時間（ISO）；畫面標示資料時間用，離線或快取命中時不會跟著現在走 */
  generatedAt: string;
}

export interface BriefRouteOptions {
  events?: RoadEvent[];
  /** 判讀時間（路況事件以此為準）；未指定 departure 時也是估算 ETA 的出發時間 */
  now?: Date;
  /** 出發時間；各路段依 ETA 挑預報時段 */
  departure?: Date;
  /** 運動類型；未指定時依路線類型 */
  activity?: Activity;
  /** 路況事件取不到的縣市；null 代表整個事件服務失敗 */
  eventsFailed?: string[] | null;
  /** 是否試算建議出發時段；只有畫面會顯示的路線才開（今日判讀目前路線、路線頁） */
  suggest?: boolean;
  /**
   * 途中模式：目前在路線上的里程。提供時 now 視為抵達 fromKm 的時間，反推出發時間（忽略 departure），
   * 判定、示警、路況事件與統計只看前方；已走過的路段不列入。不試算建議出發時段（已經出發）。
   */
  fromKm?: number;
}

export function briefRoute(
  route: Route,
  lookup: WeatherLookup,
  { events = [], now = new Date(), departure = now, activity, eventsFailed, suggest = false, fromKm }: BriefRouteOptions = {}
): RouteBriefing {
  const defaultActivity = activityOfRouteType(route.type);
  const tripActivity = activity ?? defaultActivity;
  const speedKmh = ACTIVITY[tripActivity].speedKmh;
  // 爬升修正依完整路線的高程計算；途中模式也用同一個 pace，ETA 才會是 hoursTo(k) − hoursTo(fromKm)
  const pace = paceFor(tripActivity, route.elevationProfile);
  const totalKm = routeTotalKm(route);
  const aheadFrom = fromKm != null && Number.isFinite(fromKm) && fromKm > 0 ? Math.min(fromKm, totalKm) : null;
  const tripDeparture = aheadFrom != null ? departureForPosition(now, aheadFrom, pace) : departure;
  // 途中模式只對前方路段套天氣：目前所在路段的進入 ETA 為 now，不會挑到已過去的預報時段
  const ahead = aheadFrom != null ? clipRouteFrom(route, aheadFrom) : route;
  const weatherOptions = { departureTime: tripDeparture, pace };
  const enriched = withObservedRainFor(applyWeather(ahead, lookup, weatherOptions), weatherOptions, now);
  const stages = aheadFrom != null ? clipStagesFrom(deriveStages(enriched), aheadFrom) : deriveStages(enriched);
  const matched = matchEventsToRoute(events, buildRoutePolylineKm(route), { now });
  const roadEvents = aheadFrom != null ? matched.filter((e) => e.km >= aheadFrom) : matched;
  const hazards = [...computeHazards(enriched, stages).filter(isWeatherHazard), ...eventHazards(roadEvents)].sort(
    (a, b) => a.startKm - b.startKm
  );

  // 超出預報時段的路段數值不可當真，不列入統計
  const withWeather = enriched.segments.filter((s) => s.hasWeather && !s.outOfCoverage);
  const routeEventsFailed = failedOnRoute(route, eventsFailed);
  const temps = withWeather.map((s) => s.temperature);

  return {
    id: route.id,
    name: route.nameZh || route.name,
    distanceKm: totalKm,
    elevationGainM: route.elevationGain,
    verdict: summarizeVerdict(hazards, stages, { eventsFailed: routeEventsFailed }),
    hazards,
    roadEvents,
    maxRain: withWeather.length ? Math.max(...withWeather.map((s) => s.rainProbability)) : null,
    maxWindKmh: withWeather.length ? Math.max(...withWeather.map((s) => s.windSpeed)) : null,
    temperature: temps.length ? { min: Math.min(...temps), max: Math.max(...temps) } : null,
    periodLabel: usedPeriodLabel(ahead, lookup, weatherOptions, now),
    elevationProfile: route.elevationProfile,
    segments: enriched.segments,
    eventsFailed: routeEventsFailed === undefined ? [] : routeEventsFailed,
    departureSuggestion: suggest && aheadFrom == null ? suggestDeparture(route, lookup, { now, pace }) : null,
    // 途中模式為反推的出發時間：畫面用同一組出發時間與 pace 顯示前方各里程的 ETA
    departure: tripDeparture.toISOString(),
    activity: tripActivity,
    speedKmh,
    defaultActivity,
    demo: route.demo === true,
    fromKm: aheadFrom,
    generatedAt: now.toISOString(),
  };
}

export interface DepartureSuggestion {
  /** 天氣最佳的連續出發區間起訖（ISO）；只有一個試算點時 from === to */
  from: string;
  to: string;
  /** 區間內沿途最嚴重的天氣示警；null 為沿途無天氣示警 */
  level: HazardLevel | null;
  /** 現在出發已在最佳區間內 */
  nowIsBest: boolean;
}

/** 建議出發時段的試算範圍：現在起 12 小時、每 30 分鐘一個出發時間 */
export const SUGGEST_HORIZON_H = 12;
export const SUGGEST_STEP_MIN = 30;

const WEATHER_RANK = (hazards: Hazard[]) =>
  hazards.reduce((worst, h) => Math.max(worst, h.level === "risky" ? 2 : 1), 0);

/**
 * 某個出發時間的天氣等級：0 無天氣示警、1 注意、2 危險；天氣資料不足以比較時為 null。
 * 只做天氣這一段（套天氣 → 分段 → 天氣示警），不比對路況事件、不組整份判讀，試算很多次也不貴。
 */
function weatherRankAt(
  route: Route,
  lookup: WeatherLookup,
  options: ApplyWeatherOptions & { departureTime: Date },
  now: Date
): number | null {
  const enriched = withObservedRainFor(applyWeather(route, lookup, options), options, now);
  const comparable =
    enriched.segments.length > 0 && enriched.segments.every((s) => s.hasWeather && !s.weatherStale && !s.outOfCoverage);
  if (!comparable) return null;
  return WEATHER_RANK(computeHazards(enriched, deriveStages(enriched)).filter(isWeatherHazard));
}

/**
 * 建議出發時段：對未來每 30 分鐘的出發時間，用與判讀相同的天氣規則（依 ETA 挑時段）試算，取天氣示警最輕的最早連續區間。
 * 只比天氣：路況事件以「現在」為準、對每個出發時間都一樣，不影響排序；因此建議只代表天氣，不代表安全。
 * 任一路段沒有天氣、預報過期或超出預報時段的出發時間不列入比較（未判定不可拿來推薦）。
 * 找到「無天氣示警」的區間後即停止，不必試算後面的時間。
 */
export function suggestDeparture(
  route: Route,
  lookup: WeatherLookup,
  { now, pace }: { now: Date; pace: Pace }
): DepartureSuggestion | null {
  const steps = (SUGGEST_HORIZON_H * 60) / SUGGEST_STEP_MIN;
  const ranked: { departure: Date; rank: number | null }[] = [];
  for (let i = 0; i <= steps; i++) {
    const departure = new Date(now.getTime() + i * SUGGEST_STEP_MIN * 60_000);
    const rank = weatherRankAt(route, lookup, { departureTime: departure, pace }, now);
    ranked.push({ departure, rank });
    // 最好的等級就是 0：第一段 0 的區間結束後，後面不可能更好也不會更早
    const firstZero = ranked.findIndex((r) => r.rank === 0);
    if (firstZero !== -1 && rank !== 0) break;
  }

  const usable = ranked.flatMap((r) => (r.rank === null ? [] : [r.rank]));
  if (usable.length === 0) return null;
  const best = Math.min(...usable);
  const start = ranked.findIndex((r) => r.rank === best);
  let end = start;
  while (ranked[end + 1]?.rank === best) end++;

  return {
    from: ranked[start]!.departure.toISOString(),
    to: ranked[end]!.departure.toISOString(),
    level: best === 2 ? "risky" : best === 1 ? "caution" : null,
    nowIsBest: start === 0,
  };
}

/** 越小越安全；未判定不可拿來推薦 */
const SAFETY_RANK: Record<VerdictLevel, number> = { clear: 0, caution: 1, risky: 2, unknown: 99 };

/** 路線經過的縣市（舊名正規化，例：台北縣 → 新北市） */
const routeCounties = (b: RouteBriefing) =>
  new Set(b.segments.flatMap((s) => (s.county ? [normalizeCountyForCWB(s.county)] : [])));

/**
 * 建議替代路線：和目前路線經過同一縣市、且比目前路線「更安全」的路線中最安全者；
 * 同等級時示警少者優先，再比距離短者。
 * 不跨縣市推薦（台北的路線危險，推薦台南的路線沒有意義）。
 * 目前路線已安全、未判定（無從比較），或附近沒有更安全的路線時回傳 null。
 */
export function pickAlternative(current: RouteBriefing, all: RouteBriefing[]): RouteBriefing | null {
  const level = current.verdict.level;
  if (level === "clear" || level === "unknown") return null;
  const currentRank = SAFETY_RANK[level];
  const counties = routeCounties(current);
  const nearby = (b: RouteBriefing) => [...routeCounties(b)].some((c) => counties.has(c));
  const candidates = all
    .filter((b) => b.id !== current.id && SAFETY_RANK[b.verdict.level] < currentRank && nearby(b))
    .sort(
      (a, b) =>
        SAFETY_RANK[a.verdict.level] - SAFETY_RANK[b.verdict.level] ||
        a.hazards.length - b.hazards.length ||
        a.distanceKm - b.distanceKm
    );
  return candidates[0] ?? null;
}
