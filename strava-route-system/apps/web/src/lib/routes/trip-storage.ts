/**
 * 行程設定記在 sessionStorage：網址仍是唯一依據，這裡只讓導覽列切頁回來時把上次的設定帶回網址。
 * 只在瀏覽器端呼叫；儲存被封鎖（無痕模式等）時靜默略過。
 */

import { restoreTrip, withTrip, type TripParams } from "@/lib/routes/trip";

const TRIP_STORAGE_KEY = "dawnline:trip";

/** 設定改變時通知導覽連結更新 href（同一頁不會觸發 storage 事件） */
export const TRIP_CHANGE_EVENT = "dawnline:trip-change";

export function saveTrip(trip: TripParams): void {
  try {
    const qs = withTrip("", trip).replace(/^\?/, "");
    if (qs) window.sessionStorage.setItem(TRIP_STORAGE_KEY, qs);
    else window.sessionStorage.removeItem(TRIP_STORAGE_KEY);
    window.dispatchEvent(new Event(TRIP_CHANGE_EVENT));
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
