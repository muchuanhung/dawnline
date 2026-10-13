/**
 * 里程軌道（影像主視覺下方的拖曳條）用的純函式：刻度、逐台切換、吸附、示警旗標合併
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

/** 依里程排序後的上一台／下一台鏡頭；已在頭尾時回傳 null */
export function stepMarker(
  markers: CctvMarker[],
  current: CctvMarker | null,
  dir: 1 | -1
): CctvMarker | null {
  const sorted = [...markers].sort((a, b) => a.km - b.km);
  if (sorted.length === 0) return null;
  if (!current) return dir === 1 ? sorted[0]! : null;
  const i = sorted.findIndex((m) => m.id === current.id);
  if (i === -1) return null;
  return sorted[i + dir] ?? null;
}

/** 目前鏡頭在全部鏡頭中的序號（1 起算）；找不到為 null */
export function markerOrdinal(markers: CctvMarker[], current: CctvMarker | null): number | null {
  if (!current) return null;
  const sorted = [...markers].sort((a, b) => a.km - b.km);
  const i = sorted.findIndex((m) => m.id === current.id);
  return i === -1 ? null : i + 1;
}

/** 吸附距離：全長的 5%，最多 1 km */
export function snapRadiusKm(totalKm: number): number {
  return Math.min(1, Math.max(0, totalKm) * 0.05);
}

/**
 * 放開拖曳時的落點：吸附距離內有鏡頭就停在最近的鏡頭，沒有就停在原地
 * （原地沒有鏡頭時，主畫面會顯示最近一台並說明距離）
 */
export function snapToMarker(markers: CctvMarker[], km: number, totalKm: number): number {
  const radius = snapRadiusKm(totalKm);
  let best: CctvMarker | null = null;
  for (const m of markers) {
    if (!best || Math.abs(m.km - km) < Math.abs(best.km - km)) best = m;
  }
  return best && Math.abs(best.km - km) <= radius ? best.km : km;
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
