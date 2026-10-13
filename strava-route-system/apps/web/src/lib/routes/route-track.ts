/**
 * 里程軌道（影像主視覺下方的拖曳條）用的純函式：刻度、鏡頭去重與序號、路況色段、停點
 * 不依賴 React，可單獨測試
 */

import { isBlockedByCSP } from "@/lib/cctv/embed-policy";
import type { CctvMarker, Hazard, HazardLevel, RouteStage, VerdictLevel } from "./recon-geo";

export interface TrackTick {
  /** 在軌道上的位置，0–1 */
  at: number;
  /** 顯示的整數公里 */
  km: number;
}

/** 中間刻度可用的間距（km） */
const NICE_STEPS_KM = [1, 2, 5, 10, 20, 50, 100, 200, 500];
/** 整條最多切成幾段 */
const MAX_SEGMENTS = 3;
/** 中間刻度離終點小於全長的這個比例就不標，避免與終點標籤重疊 */
const END_CLEARANCE = 0.2;

/**
 * 軌道刻度：頭尾一定標，中間取整齊間距，標籤一律整數。
 * 終點四捨五入（10.6 → 11），但位置仍在軌道最右端。
 */
export function trackTicks(totalKm: number): TrackTick[] {
  if (!(totalKm > 0)) return [{ at: 0, km: 0 }];
  const endKm = Math.round(totalKm);
  if (endKm === 0) return [{ at: 0, km: 0 }];

  const step = NICE_STEPS_KM.find((s) => s >= totalKm / MAX_SEGMENTS) ?? NICE_STEPS_KM[NICE_STEPS_KM.length - 1]!;
  const ticks: TrackTick[] = [{ at: 0, km: 0 }];
  for (let km = step; km < totalKm * (1 - END_CLEARANCE) && km < endKm; km += step) {
    ticks.push({ at: km / totalKm, km });
  }
  ticks.push({ at: 1, km: endKm });
  return ticks;
}

/** 一般路段：里程差在這個距離內的鏡頭只留一台（貼很近的鏡頭看到的路況天氣差不多） */
const NEARBY_KM = 3;
/** 示警附近：離示警範圍這個距離內最近的那台鏡頭一定保留，方便看示警處的實況 */
const HAZARD_CAM_KM = 1;

const playable = (m: CctvMarker) => (m.videoUrl && !isBlockedByCSP(m.videoUrl) ? 1 : 0);

/** 挑哪台：能內嵌播放優先，其次離路線最近 */
function betterMarker(a: CctvMarker, b: CctvMarker): CctvMarker {
  if (playable(a) !== playable(b)) return playable(a) > playable(b) ? a : b;
  return (a.distToRouteKm ?? Infinity) <= (b.distToRouteKm ?? Infinity) ? a : b;
}

/** 每個示警最近的鏡頭（在示警範圍外 HAZARD_CAM_KM 內才算） */
function hazardCameraIds(markers: CctvMarker[], hazards: Hazard[]): Set<string> {
  const ids = new Set<string>();
  for (const h of hazards) {
    let best: CctvMarker | null = null;
    let bestGap = Infinity;
    for (const m of markers) {
      const gap = m.km < h.startKm ? h.startKm - m.km : m.km > h.endKm ? m.km - h.endKm : 0;
      if (gap < bestGap || (gap === bestGap && best && betterMarker(m, best) === m)) {
        best = m;
        bestGap = gap;
      }
    }
    if (best && bestGap <= HAZARD_CAM_KM) ids.add(best.id);
  }
  return ids;
}

/**
 * 鏡頭精簡：一般路段 3 km 內只留一台（能播放優先，其次離路線最近）；
 * 但每個示警附近最近的鏡頭一定保留，示警處要看得到實況。依里程排序。
 * 以每群第一台的里程為基準分群，不會串成一長串。
 */
export function dedupeMarkers(markers: CctvMarker[], hazards: Hazard[] = []): CctvMarker[] {
  const keep = hazardCameraIds(markers, hazards);
  const sorted = [...markers].sort((a, b) => a.km - b.km);
  const kept: CctvMarker[] = [];
  let group: CctvMarker[] = [];
  const flush = () => {
    if (group.length === 0) return;
    const pinned = group.filter((m) => keep.has(m.id));
    if (pinned.length > 0) kept.push(...pinned);
    else kept.push(group.reduce(betterMarker));
    group = [];
  };
  for (const m of sorted) {
    if (group.length > 0 && m.km - group[0]!.km > NEARBY_KM) flush();
    group.push(m);
  }
  flush();
  return kept;
}

/** 目前鏡頭在全部鏡頭中的序號（1 起算）；找不到為 null */
export function markerOrdinal(markers: CctvMarker[], current: CctvMarker | null): number | null {
  if (!current) return null;
  const sorted = [...markers].sort((a, b) => a.km - b.km);
  const i = sorted.findIndex((m) => m.id === current.id);
  return i === -1 ? null : i + 1;
}

/** 軌道上的一段路況：示警路段（risky／caution）或一般路段（clear／unknown） */
export interface TrackZone {
  startKm: number;
  endKm: number;
  level: VerdictLevel;
  /** 這段的示警；一般路段為空 */
  hazards: Hazard[];
}

/** 單點示警（路況事件）在軌道上至少佔全長的這個比例，才看得到 */
const POINT_SPAN_RATIO = 0.02;
/** 同等級示警之間的空隙小於全長的這個比例就併成同一個示警路段 */
const ZONE_MERGE_RATIO = 0.06;

/**
 * 示警路段：依起點排序，同等級且彼此太近的示警併成一段。
 * 示警再密也只是一段顏色、一個停點，不會逐顆擠在軌道上。
 * 不同等級不合併，避免一段危險把旁邊的注意蓋成危險；兩者重疊時畫面上危險畫在上層。
 */
export function hazardZones(hazards: Hazard[], totalKm: number): TrackZone[] {
  const total = Math.max(0, totalKm);
  const minSpan = total * POINT_SPAN_RATIO;
  const gap = total * ZONE_MERGE_RATIO;
  const zones: TrackZone[] = [];
  const lastOf: Partial<Record<HazardLevel, TrackZone>> = {};
  for (const h of [...hazards].sort((a, b) => a.startKm - b.startKm)) {
    const startKm = Math.max(0, h.startKm);
    const endKm = Math.min(total, Math.max(h.endKm, startKm + minSpan));
    const last = lastOf[h.level];
    if (last && startKm - last.endKm < gap) {
      last.endKm = Math.max(last.endKm, endKm);
      last.hazards.push(h);
    } else {
      const zone: TrackZone = { startKm, endKm, level: h.level, hazards: [h] };
      zones.push(zone);
      lastOf[h.level] = zone;
    }
  }
  return zones;
}

export interface TrackZoneOptions {
  /** 路況事件完整取得；取不到時沒有示警的路段也只能算未判定 */
  eventsComplete: boolean;
  /** 途中模式的目前里程；之前的路段已走過，不上色 */
  fromKm?: number | null;
}

/**
 * 整條軌道的路況色段：示警路段蓋在最上層；其餘路段依天氣資料判定，
 * 有天氣、未過期、在預報時段內且路況事件完整才算安全（clear），否則一律未判定（unknown）。
 * 沒有 stage 涵蓋的里程（判讀未回來、途中模式已走過）不上色。
 */
export function trackZones(
  totalKm: number,
  hazards: Hazard[],
  stages: RouteStage[],
  { eventsComplete, fromKm }: TrackZoneOptions
): TrackZone[] {
  const start = Math.max(0, fromKm ?? 0);
  const hz = hazardZones(hazards, totalKm).filter((z) => z.endKm > start);

  const base: TrackZone[] = [];
  for (const st of stages) {
    const startKm = Math.max(st.startKm, start);
    const endKm = Math.min(st.endKm, totalKm);
    if (endKm <= startKm) continue;
    const known = eventsComplete && st.hasWeather && !st.weatherStale && !st.outOfCoverage;
    const level: VerdictLevel = known ? "clear" : "unknown";
    // 扣掉被示警路段蓋住的部分
    let cursor = startKm;
    for (const z of hz) {
      if (z.endKm <= cursor || z.startKm >= endKm) continue;
      if (z.startKm > cursor) base.push({ startKm: cursor, endKm: z.startKm, level, hazards: [] });
      cursor = Math.max(cursor, z.endKm);
    }
    if (cursor < endKm) base.push({ startKm: cursor, endKm, level, hazards: [] });
  }

  // 相鄰且同等級的一般路段合併
  const merged: TrackZone[] = [];
  for (const z of base.sort((a, b) => a.startKm - b.startKm)) {
    const last = merged[merged.length - 1];
    if (last && last.level === z.level && Math.abs(z.startKm - last.endKm) < 1e-9) last.endKm = z.endKm;
    else merged.push(z);
  }
  return [...merged, ...hz].sort((a, b) => a.startKm - b.startKm);
}

const ZONE_RANK: Record<VerdictLevel, number> = { clear: 0, unknown: 1, caution: 2, risky: 3 };

/** 指定里程所在的色段；重疊時取最嚴重的 */
export function zoneAt(zones: TrackZone[], km: number): TrackZone | null {
  let best: TrackZone | null = null;
  for (const z of zones) {
    if (km < z.startKm || km > z.endKm) continue;
    if (!best || ZONE_RANK[z.level] > ZONE_RANK[best.level]) best = z;
  }
  return best;
}

/** 繪製順序：嚴重的畫在上層，重疊時危險蓋過注意 */
export function zonesForPaint(zones: TrackZone[]): TrackZone[] {
  return [...zones].sort((a, b) => ZONE_RANK[a.level] - ZONE_RANK[b.level]);
}

/**
 * 軌道停點：拖曳與 ‹ › 只停在鏡頭與示警路段的起點，中間的公里數不停。
 * 位置仍照實際里程，不改成等距，刻度與遠近才不會失真。
 */
export type TrackStop =
  | { kind: "marker"; km: number; marker: CctvMarker }
  | { kind: "zone"; km: number; zone: TrackZone };

/** 停點的識別：鏡頭用 id，示警路段用起點里程 */
export function stopKey(stop: TrackStop): string {
  return stop.kind === "marker" ? `m:${stop.marker.id}` : `z:${stop.zone.startKm}`;
}

/** 依里程排序的停點（只取有示警的路段）；同一里程時示警排在鏡頭前，先看到示警 */
export function trackStops(markers: CctvMarker[], zones: TrackZone[]): TrackStop[] {
  const stops: TrackStop[] = [
    ...zones
      .filter((zone) => zone.hazards.length > 0)
      .map((zone) => ({ kind: "zone" as const, km: zone.startKm, zone })),
    ...markers.map((marker) => ({ kind: "marker" as const, km: marker.km, marker })),
  ];
  // Array.prototype.sort is stable, so zones stay ahead of markers at the same km
  return stops.sort((a, b) => a.km - b.km);
}
/** 離指定里程最近的停點；沒有停點時為 null（軌道改回連續拖曳） */
export function nearestStop(stops: TrackStop[], km: number): TrackStop | null {
  let best: TrackStop | null = null;
  for (const s of stops) {
    if (!best || Math.abs(s.km - km) < Math.abs(best.km - km)) best = s;
  }
  return best;
}

/**
 * 上一個／下一個停點。目前停在某個停點時照順序走（同一里程的多個停點也能逐一切換）；
 * 不在停點上時，找目前里程之後（或之前）的第一個。已在頭尾時為 null。
 */
export function stepStop(
  stops: TrackStop[],
  current: TrackStop | null,
  positionKm: number,
  dir: 1 | -1
): TrackStop | null {
  if (current) {
    const i = stops.findIndex((s) => stopKey(s) === stopKey(current));
    if (i !== -1) return stops[i + dir] ?? null;
  }
  if (dir === 1) return stops.find((s) => s.km > positionKm) ?? null;
  for (let i = stops.length - 1; i >= 0; i--) {
    if (stops[i]!.km < positionKm) return stops[i]!;
  }
  return null;
}
