/**
 * 每條路線上次的途中里程記在 localStorage（只存里程與時間，不存座標）。
 * 只在瀏覽器端呼叫；儲存被封鎖（無痕模式等）時靜默略過。
 */

import { parseRememberedKm, type AppliedKm } from "@/lib/routes/ride-position";

const keyOf = (routeId: string) => `dawnline:ride-km:${routeId}`;

export function saveRideKm(routeId: string, applied: AppliedKm): void {
  try {
    window.localStorage.setItem(keyOf(routeId), JSON.stringify(applied));
  } catch {
    // storage unavailable: nothing to remember
  }
}

export function loadRideKm(routeId: string, now: number, totalKm: number): AppliedKm | null {
  try {
    return parseRememberedKm(window.localStorage.getItem(keyOf(routeId)), now, totalKm);
  } catch {
    return null;
  }
}

export function clearRideKm(routeId: string): void {
  try {
    window.localStorage.removeItem(keyOf(routeId));
  } catch {
    // storage unavailable
  }
}
