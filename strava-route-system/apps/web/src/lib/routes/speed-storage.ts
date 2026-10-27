/**
 * 自訂平地均速存在 cookie：伺服器頁面（今日判讀、路線頁）讀得到，下次開也沿用。
 * 只在瀏覽器端呼叫；儲存被封鎖時靜默略過（回到預設均速）。
 */

import { parseSpeed, parseSpeedPrefs, serializeSpeedPrefs, SPEED_COOKIE, type Activity } from "@/lib/routes/trip";

const MAX_AGE_S = 365 * 24 * 3600;

function readCookie(): string | null {
  const hit = document.cookie.split("; ").find((c) => c.startsWith(`${SPEED_COOKIE}=`));
  return hit ? decodeURIComponent(hit.slice(SPEED_COOKIE.length + 1)) : null;
}

/** 設定某運動的平地均速；null 或等於預設值時清掉（恢復預設） */
export function saveSpeed(activity: Activity, speedKmh: number | null): void {
  try {
    const prefs = parseSpeedPrefs(readCookie());
    const speed = speedKmh != null ? parseSpeed(activity, speedKmh) : null;
    if (speed != null) prefs[activity] = speed;
    else delete prefs[activity];
    const value = serializeSpeedPrefs(prefs);
    document.cookie = value
      ? `${SPEED_COOKIE}=${encodeURIComponent(value)}; path=/; max-age=${MAX_AGE_S}; samesite=lax`
      : `${SPEED_COOKIE}=; path=/; max-age=0; samesite=lax`;
  } catch {
    // cookies unavailable: keep defaults
  }
}
