/**
 * 行程設定記在 sessionStorage：網址仍是唯一依據，這裡只讓導覽列切頁回來時把上次的設定帶回網址。
 * 只在瀏覽器端呼叫；儲存被封鎖（無痕模式等）時靜默略過。
 */

import { restoreTrip, withTrip, type TripParams } from "@/lib/routes/trip";

const TRIP_STORAGE_KEY = "dawnline:trip";

export function saveTrip(trip: TripParams): void {
  try {
    const qs = withTrip("", trip).replace(/^\?/, "");
    if (qs) window.sessionStorage.setItem(TRIP_STORAGE_KEY, qs);
    else window.sessionStorage.removeItem(TRIP_STORAGE_KEY);
  } catch {
    // storage unavailable: fall back to defaults on navigation
  }
}

export function loadTrip(now: Date): TripParams {
  try {
    return restoreTrip(window.sessionStorage.getItem(TRIP_STORAGE_KEY), now);
  } catch {
    return {};
  }
}
