/**
 * 路線偵察畫面的純函式：里程對應、CCTV 錨點、示警計算
 * 不依賴 React，可單獨測試
 */

import type { CCTVFeed, Route, RouteSegment } from "./route-data";
import { haversineKm } from "./parse-gpx";
import { decodePolyline, isPolylineEncoded } from "./polyline";

/** 離路線超過此距離（km）的鏡頭不參與主畫面切換 */
export const ROUTE_CCTV_MAX_DIST_KM = 2.0;

export type RouteStage = {
  id: string;
  /** 等於 startKm */
  km: number;
  /** 此行政區在路線上涵蓋的里程區間 */
  startKm: number;
  endKm: number;
  name: string;
  rainProbability: number;
  temperature: number;
  windSpeed: number;
  condition?: RouteSegment["condition"];
  /** 是否已取得 CWB 天氣；false 時數值為預設 0，顯示端須呈現「無資料」 */
  hasWeather?: boolean;
  /** 路線 3 km 內雨量站的即時時雨量；null 為附近沒有測站，undefined 為未查詢 */
  observedRainMmPerHr?: number | null;
  /** 此路段用的是過期預報 */
  weatherStale?: boolean;
  /** 此路段 ETA 超出預報涵蓋時段 */
  outOfCoverage?: boolean;
};

/** 單一路線上的 CCTV 錨點（供縮圖列與主畫面同步） */
export type CctvMarker = {
  id: string;
  km: number;
  name: string;
  location?: string;
  videoUrl?: string;
  lat?: number;
  lon?: number;
  /** CCTV 座標投影到 route polyline 的最短距離（km），用來排除離路很遠的鏡頭 */
  distToRouteKm?: number;
  /** 鏡頭所在行政區，標題用「鏡頭名・行政區」，避免與 location 重複 */
  township?: string;
  lastUpdated?: string;
};

export interface ChartDataPoint {
  km: number;
  elevation: number;
}

export interface RoutePolylineKm {
  points: [number, number][];
  cumulativeKm: number[];
}

/** 取陣列中 km 最接近 target 的元素 */
export function nearestByKm<T extends { km: number }>(items: T[], target: number): T | null {
  if (items.length === 0) return null;
  return items.reduce((prev, curr) =>
    Math.abs(curr.km - target) < Math.abs(prev.km - target) ? curr : prev
  );
}

/** 解碼 gpxPreviewPath，並對齊每個點的累計里程 */
export function buildRoutePolylineKm(route: Route): RoutePolylineKm | null {
  const encoded = route.gpxPreviewPath;
  if (!encoded || !isPolylineEncoded(encoded)) return null;
  try {
    const points = decodePolyline(encoded);
    if (points.length < 2) return null;

    // 優先使用 route.elevationProfile 的 km 序列做對齊（避免 polyline 座標四捨五入造成 km 漂移）
    const profileKm = route.elevationProfile.map(([km]) => km);
    if (profileKm.length === points.length) {
      return { points, cumulativeKm: profileKm };
    }

    // 如果 elevationProfile 長度跟 polyline 不一致（例如 GPX 無 ele 時的降採樣），才回退用 haversine 累加
    const cumulativeKm: number[] = [0];
    let sum = 0;
    for (let i = 1; i < points.length; i++) {
      const [lat1, lon1] = points[i - 1]!;
      const [lat2, lon2] = points[i]!;
      sum += haversineKm(lat1, lon1, lat2, lon2);
      cumulativeKm.push(sum);
    }
    return { points, cumulativeKm };
  } catch {
    return null;
  }
}

/** 部分 CCTV 資料經緯度對調，依台灣範圍判斷並修正 */
export function normalizeLatLon(lat?: number, lon?: number): { lat: number; lon: number } | null {
  if (lat == null || lon == null) return null;
  const latLooksLon = lat >= 110 && lat <= 140;
  const lonLooksLat = lon >= 15 && lon <= 40;
  if (latLooksLon && lonLooksLat) {
    return { lat: lon, lon: lat };
  }
  return { lat, lon };
}

/** 將座標投影到 polyline 的每個線段，回傳各線段上最近點的里程與離路距離（略過長度為 0 的線段） */
function projectOnSegments(
  lat: number,
  lon: number,
  points: [number, number][],
  cumulativeKm: number[]
): { km: number; distKm: number }[] {
  if (points.length < 2 || points.length !== cumulativeKm.length) return [];

  // 經緯度差是「度」，必須先轉弧度再乘地球半徑；漏轉會讓離路距離放大 57.3 倍
  const Rm = 6371000 * (Math.PI / 180); // 每度的公尺數
  const out: { km: number; distKm: number }[] = [];

  for (let i = 0; i < points.length - 1; i++) {
    const [aLat, aLon] = points[i]!;
    const [bLat, bLon] = points[i + 1]!;

    const refLat = (aLat + bLat) / 2;
    const refLon = (aLon + bLon) / 2;
    const refLatRad = (refLat * Math.PI) / 180;

    const ax = (aLon - refLon) * Math.cos(refLatRad) * Rm;
    const ay = (aLat - refLat) * Rm;
    const bx = (bLon - refLon) * Math.cos(refLatRad) * Rm;
    const by = (bLat - refLat) * Rm;
    const px = (lon - refLon) * Math.cos(refLatRad) * Rm;
    const py = (lat - refLat) * Rm;

    const vx = bx - ax;
    const vy = by - ay;
    const vLen2 = vx * vx + vy * vy;
    if (vLen2 === 0) continue;

    const t = Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / vLen2));
    const distKm = Math.hypot(px - (ax + t * vx), py - (ay + t * vy)) / 1000;
    const segKm = (cumulativeKm[i + 1] ?? 0) - (cumulativeKm[i] ?? 0);
    out.push({ km: (cumulativeKm[i] ?? 0) + t * segKm, distKm });
  }
  return out;
}

/** 將座標投影到路線 polyline，回傳對應里程與離路距離 */
export function mapLatLonToKm(
  lat: number,
  lon: number,
  points: [number, number][],
  cumulativeKm: number[]
): { km: number; distKm: number } | null {
  // 對整條 polyline 的每個線段做投影，取距離最小的那段，
  // 避免「後段彎曲時只看附近窗口會投錯里程」的問題。
  return projectOnSegments(lat, lon, points, cumulativeKm).reduce<{ km: number; distKm: number } | null>(
    (best, p) => (!best || p.distKm < best.distKm ? p : best),
    null
  );
}

/**
 * 途中模式定位：定位精度（m）超過此值不換算里程，改讓使用者手動選。
 * 判定以行政區（通常數公里）與 3 小時預報為單位，200 m 誤差換成里程約 ±0.2 km，不影響判定；畫面另顯示里程範圍。
 */
export const POSITION_MAX_ACCURACY_M = 200;
/** 途中模式定位：離路線超過此距離（km）視為不在路線上 */
export const POSITION_MAX_OFF_ROUTE_KM = 0.3;
/** 同一位置對到的兩個里程相差超過此值（km），才視為不同次經過（往返、繞圈） */
const DISTINCT_PASS_KM = 0.5;
/** 有上次里程時，容許往回對到的距離（km）：GPS 誤差、走回頭找東西 */
const BACKTRACK_TOLERANCE_KM = 0.5;

/**
 * 定位誤差換成里程範圍（取到 0.1 km）：沿路線方向最多偏差約一個定位精度，夾在 0 與總里程之間。
 * 只是給使用者看的不確定範圍，判讀仍用中心里程。
 */
export function kmRangeOf(km: number, accuracyM: number, totalKm: number): [number, number] {
  const spread = Math.max(0, accuracyM) / 1000;
  const round = (v: number) => Math.round(v * 10) / 10;
  return [round(Math.max(0, km - spread)), round(Math.min(totalKm, km + spread))];
}

export interface PositionFix {
  lat: number;
  lon: number;
  /** 定位精度（m），GeolocationCoordinates.accuracy */
  accuracyM: number;
}

export type RoutePosition =
  /** accuracyM：定位精度（m），畫面用來顯示里程範圍 */
  | { status: "on_route"; km: number; distKm: number; accuracyM: number }
  /** 往返或繞圈：同一位置對到多個里程，又無法用上次里程判斷，由使用者選 */
  | { status: "ambiguous"; candidates: number[] }
  | { status: "inaccurate"; accuracyM: number }
  | { status: "off_route"; distKm: number }
  /** 路線沒有可用的 polyline */
  | { status: "no_route" };

/**
 * 手機定位 → 路線里程。資料不足一律不猜：
 * 精度太差回 inaccurate、離路太遠回 off_route、同一位置對到多次經過且無法判斷時回 ambiguous。
 * 多次經過的判斷：各線段投影中，離路距離與最近者相差不超過定位精度（至少 50 m）的才算候選，
 * 候選依里程分群（相差超過 0.5 km 才算另一次經過）；有上次里程時取「不早於上次里程」的第一群。
 * 之字形山路相鄰兩段雖然直線距離近，離路距離差超過定位精度就不會被當成候選。
 */
export function locateOnRoute(
  fix: PositionFix,
  polyline: RoutePolylineKm | null,
  { previousKm }: { previousKm?: number } = {}
): RoutePosition {
  if (!polyline) return { status: "no_route" };
  if (!(fix.accuracyM <= POSITION_MAX_ACCURACY_M)) return { status: "inaccurate", accuracyM: fix.accuracyM };
  const projections = projectOnSegments(fix.lat, fix.lon, polyline.points, polyline.cumulativeKm);
  if (projections.length === 0) return { status: "no_route" };

  const bestDist = Math.min(...projections.map((p) => p.distKm));
  if (bestDist > POSITION_MAX_OFF_ROUTE_KM) return { status: "off_route", distKm: bestDist };

  const slackKm = Math.max(fix.accuracyM, 50) / 1000;
  const near = projections.filter((p) => p.distKm <= bestDist + slackKm).sort((a, b) => a.km - b.km);

  // 依里程分群，每群取離路最近的點作代表
  const passes: { km: number; distKm: number }[] = [];
  let lastKm = -Infinity;
  for (const p of near) {
    const current = passes[passes.length - 1];
    if (current && p.km - lastKm <= DISTINCT_PASS_KM) {
      if (p.distKm < current.distKm) passes[passes.length - 1] = p;
    } else {
      passes.push(p);
    }
    lastKm = p.km;
  }

  if (passes.length === 1) return { status: "on_route", ...passes[0]!, accuracyM: fix.accuracyM };
  if (previousKm != null) {
    const next = passes.find((p) => p.km >= previousKm - BACKTRACK_TOLERANCE_KM);
    if (next) return { status: "on_route", ...next, accuracyM: fix.accuracyM };
  }
  return { status: "ambiguous", candidates: passes.map((p) => Math.round(p.km * 10) / 10) };
}

/** 路線總里程 */
export function routeTotalKm(route: Route): number {
  const ep = route.elevationProfile ?? [];
  return route.distance ?? (ep[ep.length - 1]?.[0] ?? 0);
}

/**
 * 依行政區取樣里程切出路段：所有 sampleKms 依里程排序，連續同一行政區合併為一個 stage，
 * 相鄰 stage 的交界取兩側最近取樣點的中點。
 * 同時相容舊快取資料：5 點取樣、同一行政區不連續的 sampleKms（環狀路線）也會正確拆開排序。
 * 完全沒有 sampleKms 的舊資料退回 0/25%/50%/75%/100% 依索引對應。
 */
export function deriveStages(route: Route): RouteStage[] {
  const ep = route.elevationProfile ?? [];
  const segs = route.segments ?? [];
  if (ep.length === 0) return [];
  const totalKm = routeTotalKm(route);

  const samples: { km: number; seg: RouteSegment | undefined }[] = segs.some((s) => s.sampleKms?.length)
    ? segs.flatMap((seg) => (seg.sampleKms ?? []).map((km) => ({ km, seg })))
    : [0, 0.25, 0.5, 0.75, 1].map((r, i) => ({ km: totalKm * r, seg: segs[Math.min(i, segs.length - 1)] }));
  samples.sort((a, b) => a.km - b.km);

  const keyOf = (seg: RouteSegment | undefined) => (seg ? `${seg.county ?? ""}|${seg.districtZh}` : "");
  const runs: { seg: RouteSegment | undefined; firstKm: number; lastKm: number }[] = [];
  for (const { km, seg } of samples) {
    const last = runs[runs.length - 1];
    if (last && keyOf(last.seg) === keyOf(seg)) last.lastKm = km;
    else runs.push({ seg, firstKm: km, lastKm: km });
  }

  return runs.map(({ seg }, i) => {
    const prev = runs[i - 1];
    const next = runs[i + 1];
    const startKm = prev ? (prev.lastKm + runs[i]!.firstKm) / 2 : 0;
    const endKm = next ? (runs[i]!.lastKm + next.firstKm) / 2 : totalKm;
    return {
      id: `stage-${i}`,
      km: startKm,
      startKm,
      endKm,
      name: seg?.districtZh ?? `路段 ${i + 1}`,
      rainProbability: seg?.rainProbability ?? 0,
      temperature: seg?.temperature ?? 0,
      windSpeed: seg?.windSpeed ?? 0,
      condition: seg?.condition,
      hasWeather: seg?.hasWeather ?? false,
      observedRainMmPerHr: seg?.observedRainMmPerHr,
      weatherStale: seg?.weatherStale ?? false,
      outOfCoverage: seg?.outOfCoverage ?? false,
    };
  });
}

/**
 * 途中模式：只保留第 fromKm 公里以後的路段。
 * 各路段的 sampleKms 只留不早於 fromKm 的取樣點；fromKm 所在路段（依 deriveStages 的交界判斷）即使取樣點都在後方，
 * 也以 fromKm 作為它的取樣點保留，確保目前所在的行政區仍列入判定。已完全走過的路段移除。
 * 沒有 sampleKms 的舊資料無法判斷，原樣回傳（由呼叫端再裁切 stage）。
 */
export function clipRouteFrom(route: Route, fromKm: number): Route {
  const segs = route.segments ?? [];
  if (fromKm <= 0 || !segs.some((s) => s.sampleKms?.length)) return route;

  // 與 deriveStages 相同：所有取樣點依里程排序，fromKm 落在前後兩點中點之前就屬於前一點的路段
  const samples = segs.flatMap((seg) => (seg.sampleKms ?? []).map((km) => ({ km, seg }))).sort((a, b) => a.km - b.km);
  const nextIdx = samples.findIndex((s) => s.km >= fromKm);
  const prev = nextIdx === -1 ? samples[samples.length - 1] : samples[nextIdx - 1];
  const next = nextIdx === -1 ? undefined : samples[nextIdx];
  const current = prev && (!next || fromKm < (prev.km + next.km) / 2) ? prev.seg : next?.seg;

  const segments = segs.flatMap((seg) => {
    const ahead = (seg.sampleKms ?? []).filter((km) => km >= fromKm);
    if (seg === current && (ahead.length === 0 || ahead[0]! > fromKm)) return [{ ...seg, sampleKms: [fromKm, ...ahead] }];
    return ahead.length > 0 ? [{ ...seg, sampleKms: ahead }] : [];
  });
  return { ...route, segments };
}

/** 途中模式：只留 fromKm 以後的 stage，第一段的起點改為 fromKm */
export function clipStagesFrom(stages: RouteStage[], fromKm: number): RouteStage[] {
  if (fromKm <= 0) return stages;
  return stages
    .filter((s) => s.endKm > fromKm)
    .map((s) => (s.startKm >= fromKm ? s : { ...s, km: fromKm, startKm: fromKm }));
}

/** 里程所在的 stage（依 startKm/endKm 區間，不是最近的代表點） */
export function stageAtKm(stages: RouteStage[], km: number): RouteStage | null {
  return stages.find((s) => km < s.endKm) ?? stages[stages.length - 1] ?? null;
}

/** 將 CCTV 清單投影到路線上，依里程排序。沒有鏡頭時回傳空陣列（不產生假錨點） */
export function buildCctvMarkers(
  route: Route,
  feeds: CCTVFeed[],
  routePolyline?: RoutePolylineKm | null
): CctvMarker[] {
  if (feeds.length === 0) return [];
  const totalKm = routeTotalKm(route);
  const n = feeds.length;
  const getDefaultKm = (i: number) => (n === 1 ? totalKm / 2 : (totalKm * (i + 1)) / (n + 1));

  return feeds
    .map((feed, i) => {
      const normalized = normalizeLatLon(feed.lat, feed.lon);
      const mapped =
        routePolyline && normalized
          ? mapLatLonToKm(normalized.lat, normalized.lon, routePolyline.points, routePolyline.cumulativeKm)
          : null;

      return {
        id: feed.id,
        km: mapped?.km ?? getDefaultKm(i),
        distToRouteKm: mapped?.distKm,
        name: feed.label || feed.location,
        location: feed.location || feed.label || undefined,
        videoUrl: feed.videoUrl,
        lat: normalized?.lat,
        lon: normalized?.lon,
        township: feed.township,
        lastUpdated: feed.lastUpdated,
      } satisfies CctvMarker;
    })
    .sort((a, b) => a.km - b.km);
}

/** 初始主畫面鏡頭：偏好陽明山至善路口，否則取離 GPX 起點最近的一台 */
export function pickInitialMarker(
  markers: CctvMarker[],
  routePolyline?: RoutePolylineKm | null
): CctvMarker | null {
  if (markers.length === 0) return null;

  // 若靜態補充的期望鏡頭存在，優先用它（避免剛好被同區其他近鏡頭搶走）
  const preferred =
    markers.find((m) => m.id.includes("bot236")) ??
    markers.find((m) => m.name.includes("至善路口"));
  if (preferred) return preferred;

  const startPoint = routePolyline?.points[0];
  if (!startPoint) return markers[0] ?? null;
  const [startLat, startLon] = startPoint;

  return markers.reduce((best, curr) => {
    if (best.lat == null || best.lon == null) return curr;
    if (curr.lat == null || curr.lon == null) return best;
    const dBest = haversineKm(startLat, startLon, best.lat, best.lon);
    const dCurr = haversineKm(startLat, startLon, curr.lat, curr.lon);
    return dCurr < dBest ? curr : best;
  }, markers[0]!);
}

/** 主畫面鏡頭：只在離路線 ≤ ROUTE_CCTV_MAX_DIST_KM 的鏡頭中挑，沒有就退回全部 */
export function pickActiveMarker(markers: CctvMarker[], km: number): CctvMarker | null {
  const onRoute = markers.filter(
    (m) => m.distToRouteKm != null && m.distToRouteKm <= ROUTE_CCTV_MAX_DIST_KM
  );
  return nearestByKm(onRoute.length > 0 ? onRoute : markers, km);
}

// ---------------------------------------------------------------------------
// 示警
// ---------------------------------------------------------------------------

/** event：TDX 即時路況事件（災害、事故、管制、天氣、異常告警），由 lib/routes/road-events 產生 */
export type HazardKind = "rain" | "wind" | "storm" | "event";
export type HazardLevel = "caution" | "risky";

export interface Hazard {
  id: string;
  kind: HazardKind;
  level: HazardLevel;
  startKm: number;
  endKm: number;
  /** 例：「降雨 70%」「事故：交通事故」 */
  label: string;
}

/**
 * 天氣類示警（降雨、風、雷雨），用來與路況事件（event）區分。
 * 陡坡是路線固定特性，產品上不計算、不示警。
 */
export const isWeatherHazard = (h: Hazard) => h.kind === "rain" || h.kind === "wind" || h.kind === "storm";

/** 天氣門檻 */
export const RAIN_CAUTION = 40;
export const RAIN_RISKY = 60;
/** 風速（km/h）依蒲福風級：5 級（8.0 m/s≈29 km/h）起騎乘明顯吃力；7 級（13.9 m/s≈50 km/h）起難以控車 */
export const WIND_CAUTION = 29;
export const WIND_RISKY = 50;
/** 即時時雨量門檻（mm/hr），與 district-weather 的 computeVerdict 一致：0.5 起小雨、2.6 起中雨 */
export const RAIN_NOW_CAUTION = 0.5;
export const RAIN_NOW_RISKY = 2.6;

const LEVEL_RANK: Record<HazardLevel, number> = { caution: 1, risky: 2 };

export function rainLevel(pct: number): HazardLevel | null {
  if (pct >= RAIN_RISKY) return "risky";
  if (pct >= RAIN_CAUTION) return "caution";
  return null;
}

export function observedRainLevel(mmPerHr: number): HazardLevel | null {
  if (mmPerHr >= RAIN_NOW_RISKY) return "risky";
  if (mmPerHr >= RAIN_NOW_CAUTION) return "caution";
  return null;
}

export function windLevel(kmh: number): HazardLevel | null {
  if (kmh >= WIND_RISKY) return "risky";
  if (kmh >= WIND_CAUTION) return "caution";
  return null;
}

/** observed：即時雨量（value 為 mm/hr），與預報降雨機率（value 為 %）分開合併與標示 */
type RawHazard = Omit<Hazard, "id" | "label"> & { value: number; observed?: boolean };

/** 相鄰且同類型同等級的區段合併，保留最大值 */
function mergeAdjacent(items: RawHazard[]): RawHazard[] {
  const out: RawHazard[] = [];
  for (const h of items) {
    const last = out[out.length - 1];
    if (last && last.kind === h.kind && last.level === h.level && h.startKm - last.endKm < 1e-6) {
      last.endKm = h.endKm;
      last.value = Math.max(last.value, h.value);
    } else {
      out.push({ ...h });
    }
  }
  return out;
}

function weatherHazards(stages: RouteStage[]): RawHazard[] {
  const byKind: Record<"rain" | "wind" | "storm", RawHazard[]> = { rain: [], wind: [], storm: [] };
  const observedRain: RawHazard[] = [];

  stages.forEach((s) => {
    if (!s.hasWeather) return;
    const { startKm, endKm } = s;
    // 超出預報時段：沒有對應時段的預報，不拿其他時段的數值產生示警（判定由 summarizeVerdict 改 unknown）
    const forecastUsable = !s.outOfCoverage;
    const rain = forecastUsable ? rainLevel(s.rainProbability) : null;
    if (rain) byKind.rain.push({ kind: "rain", level: rain, startKm, endKm, value: s.rainProbability });
    const wind = forecastUsable ? windLevel(s.windSpeed) : null;
    if (wind) byKind.wind.push({ kind: "wind", level: wind, startKm, endKm, value: s.windSpeed });
    if (!forecastUsable) {
      // 不產生預報類示警
    } else if (s.condition === "stormy") {
      byKind.storm.push({ kind: "storm", level: "risky", startKm, endKm, value: 0 });
    } else if (s.condition === "rainy" && !rain) {
      // 預報有雨但降雨機率未達門檻，列為注意
      byKind.rain.push({ kind: "rain", level: "caution", startKm, endKm, value: s.rainProbability });
    }
    const mm = s.observedRainMmPerHr;
    const observed = mm == null ? null : observedRainLevel(mm);
    if (observed && mm != null) {
      observedRain.push({ kind: "rain", level: observed, startKm, endKm, value: mm, observed: true });
    }
  });

  return [
    ...mergeAdjacent(byKind.rain),
    ...mergeAdjacent(observedRain),
    ...mergeAdjacent(byKind.wind),
    ...mergeAdjacent(byKind.storm),
  ];
}

const KIND_LABEL: Record<HazardKind, (v: number) => string> = {
  rain: (v) => `降雨 ${v}%`,
  wind: (v) => `風速 ${v} km/h`,
  storm: () => "雷雨",
  // computeHazards 不產生 event；路況事件的標籤由 road-events 直接帶入
  event: () => "路況事件",
};

/** 全線天氣示警，依起點里程排序（路況事件另由 road-events 產生） */
export function computeHazards(_route: Route, stages: RouteStage[]): Hazard[] {
  return weatherHazards(stages)
    .sort((a, b) => a.startKm - b.startKm || LEVEL_RANK[b.level] - LEVEL_RANK[a.level])
    .map((h, i) => ({
      id: `${h.kind}-${i}`,
      kind: h.kind,
      level: h.level,
      startKm: h.startKm,
      endKm: h.endKm,
      label: h.observed ? `即時雨量 ${h.value} mm/hr` : KIND_LABEL[h.kind](h.value),
    }));
}

export type VerdictLevel = HazardLevel | "clear" | "unknown";

/** 未判定的原因：資料缺漏／預報過期／超出預報時段 */
export type UnknownReason = "no_data" | "stale" | "out_of_coverage";

/** 未判定原因的說明文案（badge 相同，點開看原因） */
export const UNKNOWN_REASON_TEXT: Record<UnknownReason, { title: string; detail: string }> = {
  no_data: { title: "資料缺漏", detail: "部分路段的天氣或路況資料取不到。" },
  stale: { title: "預報過期", detail: "氣象署預報尚未更新，目前只有過期的預報。" },
  out_of_coverage: { title: "超出預報時段", detail: "預計抵達時間超出目前預報涵蓋的時段。" },
};

export interface ReconVerdict {
  level: VerdictLevel;
  /** 僅 level 為 unknown 時有值，依 no_data → stale → out_of_coverage 排序 */
  reasons?: UnknownReason[];
  /** 最嚴重示警的描述，例：「12.4 km 起降雨 70%」 */
  headline: string;
  /** 其他補充，例：「另有 2 項示警」「部分路段無天氣資料」 */
  note: string;
}

export interface VerdictOptions {
  /**
   * 此路線涵蓋縣市中，路況事件取不到者；null 代表整個事件服務失敗。
   * undefined 或空陣列代表事件資料完整。
   */
  eventsFailed?: string[] | null;
}

/**
 * 全線判定：取最嚴重的示警。
 * 資料不完整（部分路段無天氣、路況事件取不到）時不可判為安全，改為 unknown；
 * 但已知的 risky／caution 示警仍優先，不會被 unknown 蓋掉。
 */
export function summarizeVerdict(
  hazards: Hazard[],
  stages: RouteStage[],
  { eventsFailed }: VerdictOptions = {}
): ReconVerdict {
  const withWeather = stages.filter((s) => s.hasWeather).length;
  const noWeather = withWeather === 0;
  const partial = withWeather > 0 && withWeather < stages.length;
  const eventsIncomplete = eventsFailed === null || (eventsFailed?.length ?? 0) > 0;
  // 即時雨量只是補充：附近沒有測站時加註，不改判 unknown（預報資料仍在）
  const noNearbyGauge = stages.some((s) => s.hasWeather && s.observedRainMmPerHr === null);

  const worst = hazards.reduce<Hazard | null>(
    (best, h) => (!best || LEVEL_RANK[h.level] > LEVEL_RANK[best.level] ? h : best),
    null
  );

  const notes: string[] = [];
  if (worst && hazards.length > 1) notes.push(`另有 ${hazards.length - 1} 項示警`);
  if (noWeather && worst) notes.push("尚無天氣資料");
  if (partial) notes.push("部分路段無天氣資料");
  if (noNearbyGauge) notes.push("部分路段附近無即時雨量站");
  if (eventsFailed === null) notes.push("路況事件暫時取不到");
  else if (eventsFailed?.length) notes.push(`${eventsFailed.join("、")}路況事件取不到`);
  const note = notes.join("・");

  if (worst) {
    return { level: worst.level, headline: `${worst.startKm.toFixed(1)} km 起${worst.label}`, note };
  }
  const reasons: UnknownReason[] = [];
  if (noWeather || partial || eventsIncomplete) reasons.push("no_data");
  if (stages.some((s) => s.hasWeather && s.weatherStale)) reasons.push("stale");
  if (stages.some((s) => s.hasWeather && s.outOfCoverage)) reasons.push("out_of_coverage");
  if (noWeather) {
    return { level: "unknown", reasons, headline: "尚無天氣資料", note: note || "資料不足，無法判定，不代表安全。" };
  }
  if (reasons.length > 0) {
    const headline =
      reasons.length === 1 && reasons[0] !== "no_data"
        ? `${UNKNOWN_REASON_TEXT[reasons[0]!].title}，無法確認安全`
        : "資料不完整，無法確認安全";
    return { level: "unknown", reasons, headline, note };
  }
  return { level: "clear", headline: "沿途無示警", note };
}
