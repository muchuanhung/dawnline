/**
 * TDX 即時道路事件的純函式：解析、分級、對應到路線
 * 不依賴 React 與伺服器，可單元測試；伺服器端抓取在 lib/tdx/road-events.server.ts。
 *
 * EventType 代碼依 TDX「道路事件 v1」官方 API 規格
 * （swagger 60abfa19-ffe3-4eef-a4b1-0539435dfca9，EventSubType 百位數 = EventType）：
 *   1 交通事故、2 施工、3 壅塞、4 特殊管制（402 預警性封閉）、5 天氣（濃霧、豪雨、颱風…）、
 *   6 災害（落石、坍方、淹水、土石流…）、7 活動、8 其它異常告警（散落物、坑洞、故障車…）
 * 注意：運研所報告中地方自動偵測平台的編碼（5 = 災害）與 TDX 不同，不可混用。
 *
 * 分級：
 * - 災害(6) → 判「危險」
 * - 交通事故(1)、特殊管制(4)、天氣(5)、異常告警(8) → 判「注意」
 * - 施工(2)、壅塞(3)、活動(7) → 列出但不影響判定
 * - 其他的施工（298：多為道管中心的道路維護許可，無到期時間、數量大）→ 收合成一行，避免洗版；
 *   同一處常有多張許可（不同 EventID、說明都是「道路維護」），展開時再併成一列標 ×N
 */

import { mapLatLonToKm, type Hazard, type RoutePolylineKm } from "@/lib/routes/recon-geo";

export type RoadEventCategory =
  | "accident"
  | "construction"
  | "congestion"
  | "control"
  | "weather"
  | "disaster"
  | "activity"
  | "anomaly"
  | "other";

export interface RoadEvent {
  id: string;
  type: number;
  subType: number;
  title: string;
  description: string;
  lat: number;
  lon: number;
  source: string;
  /** ISO 字串（含 +08:00） */
  effectiveTime: string | null;
  expireTime: string | null;
  updatedTime: string | null;
}

export interface RouteEvent extends RoadEvent {
  category: RoadEventCategory;
  /** 其他的施工（298）：收合顯示 */
  routine: boolean;
  /** 是否影響出發判定 */
  affectsVerdict: boolean;
  km: number;
  distKm: number;
}

export const CATEGORY_LABEL: Record<RoadEventCategory, string> = {
  accident: "事故",
  construction: "施工",
  congestion: "壅塞",
  control: "管制",
  weather: "天氣",
  disaster: "災害",
  activity: "活動",
  anomaly: "異常告警",
  other: "路況",
};

/** 事件離路線多近才算「在路線上」：事件發生在道路上，門檻比監視器（2 km）嚴 */
export const EVENT_MAX_DIST_KM = 0.15;
/** TDX 次類別 298「其他的施工」 */
const OTHER_CONSTRUCTION_SUBTYPE = 298;

const CATEGORY_BY_TYPE: Record<number, RoadEventCategory> = {
  1: "accident",
  2: "construction",
  3: "congestion",
  4: "control",
  5: "weather",
  6: "disaster",
  7: "activity",
  8: "anomaly",
};

export function categoryOf(type: number): RoadEventCategory {
  return CATEGORY_BY_TYPE[type] ?? "other";
}

const VERDICT_CATEGORIES = new Set<RoadEventCategory>(["disaster", "accident", "control", "weather", "anomaly"]);

type TdxRawEvent = {
  EventID?: string;
  EventTitle?: string;
  Description?: string;
  EventType?: number;
  EventSubType?: number;
  Positions?: string;
  Source?: string;
  EffectiveTime?: string;
  ExpireTime?: string;
  LastUpdateTime?: string;
};

/** TDX 原始資料 → RoadEvent；沒有可用座標（POINT）的事件回傳 null */
export function parseTdxEvent(raw: TdxRawEvent): RoadEvent | null {
  const m = String(raw.Positions ?? "").match(/POINT\s*\(\s*(-?[\d.]+)\s+(-?[\d.]+)\s*\)/i);
  if (!m || !raw.EventID) return null;
  const lon = Number(m[1]);
  const lat = Number(m[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return {
    id: raw.EventID,
    type: raw.EventType ?? 0,
    subType: raw.EventSubType ?? 0,
    title: (raw.EventTitle ?? "").trim() || "路況事件",
    description: (raw.Description ?? "").trim(),
    lat,
    lon,
    source: raw.Source ?? "",
    effectiveTime: raw.EffectiveTime ?? null,
    expireTime: raw.ExpireTime ?? null,
    updatedTime: raw.LastUpdateTime ?? null,
  };
}

/** 目前有效：已生效且未到期（沒有時間欄位視為有效） */
export function isActive(e: RoadEvent, now: Date = new Date()): boolean {
  const t = now.getTime();
  if (e.effectiveTime && Date.parse(e.effectiveTime) > t) return false;
  if (e.expireTime && Date.parse(e.expireTime) <= t) return false;
  return true;
}

/** 有效事件中，落在路線 maxDistKm 內者，依里程排序 */
export function matchEventsToRoute(
  events: RoadEvent[],
  polyline: RoutePolylineKm | null,
  { now = new Date(), maxDistKm = EVENT_MAX_DIST_KM }: { now?: Date; maxDistKm?: number } = {}
): RouteEvent[] {
  if (!polyline) return [];
  // 先用路線範圍框（外擴 maxDistKm）排除遠處事件：台北一次就有數百筆，
  // 逐筆對整條折線求距離在伺服器端是同步的重運算
  const lats = polyline.points.map((p) => p[0]);
  const lons = polyline.points.map((p) => p[1]);
  const padLat = maxDistKm / 110.574;
  const padLon = maxDistKm / (111.32 * Math.cos((Math.max(...lats.map(Math.abs)) * Math.PI) / 180));
  const [minLat, maxLat] = [Math.min(...lats) - padLat, Math.max(...lats) + padLat];
  const [minLon, maxLon] = [Math.min(...lons) - padLon, Math.max(...lons) + padLon];

  const out: RouteEvent[] = [];
  // 同一 EventID 只取一次（縣市資料重疊或來源重複送時不重複列出）
  const seen = new Set<string>();
  for (const e of events) {
    if (seen.has(e.id)) continue;
    if (e.lat < minLat || e.lat > maxLat || e.lon < minLon || e.lon > maxLon) continue;
    if (!isActive(e, now)) continue;
    const hit = mapLatLonToKm(e.lat, e.lon, polyline.points, polyline.cumulativeKm);
    if (!hit || hit.distKm > maxDistKm) continue;
    const category = categoryOf(e.type);
    seen.add(e.id);
    out.push({
      ...e,
      category,
      routine: e.subType === OTHER_CONSTRUCTION_SUBTYPE,
      affectsVerdict: VERDICT_CATEGORIES.has(category),
      km: hit.km,
      distKm: hit.distKm,
    });
  }
  return out.sort((a, b) => a.km - b.km);
}

/** 影響判定的事件 → 示警：災害判「危險」；其餘（含 402 預警性封閉）判「注意」 */
export function eventHazards(routeEvents: RouteEvent[]): Hazard[] {
  return routeEvents
    .filter((e) => e.affectsVerdict)
    .map((e) => ({
      id: `event-${e.id}`,
      kind: "event" as const,
      level: e.category === "disaster" ? ("risky" as const) : ("caution" as const),
      startKm: e.km,
      endKm: e.km,
      label: `${CATEGORY_LABEL[e.category]}：${e.title}`,
    }));
}

/** 顯示分組：影響判定者走示警清單；其餘分成一般路況與例行維護 */
export function groupRouteEvents(routeEvents: RouteEvent[]) {
  return {
    notices: routeEvents.filter((e) => !e.affectsVerdict && !e.routine),
    routine: routeEvents.filter((e) => !e.affectsVerdict && e.routine),
  };
}

/** 一筆路況在清單上顯示的說明：有說明用說明（施工多為用途，如「道路維護」），否則用標題 */
export function eventText(e: RoadEvent): string {
  return e.description || e.title;
}

/** 例行施工同一處的判斷距離：清單里程顯示到 0.1 km，差不到這個距離的看起來就是同一處 */
export const ROUTINE_SPOT_KM = 0.1;

/** 例行施工的一處：同一處、說明相同的多筆事件併成一列 */
export interface RoutineSpot {
  km: number;
  text: string;
  events: RouteEvent[];
}

/**
 * 例行施工依「同一處＋同說明」併列：道管中心同一路口常同時有多張許可，
 * 各自是不同事件，但畫面上只看得到同一句「道路維護」，逐筆列出像是重複。
 * 依里程排序後，與該處第一筆相距 ROUTINE_SPOT_KM 內且說明相同者併入。
 */
export function routineSpots(routine: RouteEvent[]): RoutineSpot[] {
  const spots: RoutineSpot[] = [];
  for (const e of [...routine].sort((a, b) => a.km - b.km)) {
    const text = eventText(e);
    const spot = spots.find((s) => s.text === text && Math.abs(e.km - s.km) <= ROUTINE_SPOT_KM + 1e-9);
    if (spot) spot.events.push(e);
    else spots.push({ km: e.km, text, events: [e] });
  }
  return spots;
}
