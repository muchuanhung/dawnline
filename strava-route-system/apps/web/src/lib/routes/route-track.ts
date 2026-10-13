/**
 * 里程軌道（影像主視覺下方的拖曳條）用的純函式：刻度、逐台切換、停點、示警旗標合併
 * 不依賴 React，可單獨測試
 */

import type { CctvMarker, Hazard, HazardLevel } from "./recon-geo";

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

/** 目前鏡頭在全部鏡頭中的序號（1 起算）；找不到為 null */
export function markerOrdinal(markers: CctvMarker[], current: CctvMarker | null): number | null {
  if (!current) return null;
  const sorted = [...markers].sort((a, b) => a.km - b.km);
  const i = sorted.findIndex((m) => m.id === current.id);
  return i === -1 ? null : i + 1;
}

export interface TrackFlag {
  /** 旗標所在里程：群組內第一個示警的起點 */
  km: number;
  /** 群組內最嚴重的等級 */
  level: HazardLevel;
  hazards: Hazard[];
}

/** 旗標間距小於全長的這個比例就合併成一支 */
const FLAG_MERGE_RATIO = 0.06;

/** 示警旗標：依起點排序，彼此太近的合併成一支，等級取最嚴重 */
export function groupTrackFlags(hazards: Hazard[], totalKm: number): TrackFlag[] {
  const gap = Math.max(0, totalKm) * FLAG_MERGE_RATIO;
  const sorted = [...hazards].sort((a, b) => a.startKm - b.startKm);
  const flags: TrackFlag[] = [];
  for (const h of sorted) {
    const last = flags[flags.length - 1];
    if (last && h.startKm - last.km < gap) {
      last.hazards.push(h);
      if (h.level === "risky") last.level = "risky";
    } else {
      flags.push({ km: h.startKm, level: h.level, hazards: [h] });
    }
  }
  return flags;
}

/**
 * 軌道停點：拖曳與 ‹ › 只停在鏡頭與示警旗標，中間的公里數不停。
 * 位置仍照實際里程，不改成等距，刻度與遠近才不會失真。
 */
export type TrackStop =
  | { kind: "marker"; km: number; marker: CctvMarker }
  | { kind: "flag"; km: number; flag: TrackFlag };

/** 停點的識別：鏡頭用 id，旗標用里程（同一里程只會有一支旗標） */
export function stopKey(stop: TrackStop): string {
  return stop.kind === "marker" ? `m:${stop.marker.id}` : `f:${stop.flag.km}`;
}

/** 依里程排序的停點；同一里程時示警排在鏡頭前，先看到示警 */
export function trackStops(markers: CctvMarker[], flags: TrackFlag[]): TrackStop[] {
  const stops: TrackStop[] = [
    ...flags.map((flag) => ({ kind: "flag" as const, km: flag.km, flag })),
    ...markers.map((marker) => ({ kind: "marker" as const, km: marker.km, marker })),
  ];
  // Array.prototype.sort is stable, so flags stay ahead of markers at the same km
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
