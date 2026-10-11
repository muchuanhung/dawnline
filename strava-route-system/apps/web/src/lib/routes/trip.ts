/**
 * 行程設定：出發時間與運動類型 → 估算各段預估到達時間（ETA）用的均速。
 * 純函式，不依賴 React 與伺服器；今日判讀、路線頁與 API 共用。
 */

import type { Route } from "@/lib/routes/route-data";
import { DEFAULT_CYCLING_SPEED_KMH, estimateArrivalTime, type Pace } from "@/lib/cwb/forecast-eta";

export type Activity = "cycling" | "running" | "hiking";

/**
 * 均速含停等，規則式估算。健行另依爬升加時間（Naismith 規則：每爬升 600 m 加 1 小時，即每 100 m 加 10 分鐘）；
 * 自行車、跑步不另加（均速已含一般起伏）。
 */
export const ACTIVITY: Record<Activity, { label: string; speedKmh: number; climbMinPer100m: number }> = {
  cycling: { label: "自行車", speedKmh: DEFAULT_CYCLING_SPEED_KMH, climbMinPer100m: 0 },
  running: { label: "跑步", speedKmh: 10, climbMinPer100m: 0 },
  hiking: { label: "健行", speedKmh: 4, climbMinPer100m: 10 },
};

/**
 * 行進速度：不加爬升時就是均速；加爬升時回傳「起點到某里程所需小時數」＝ 距離 ÷ 均速 ＋ 累計爬升 × 每 100 m 分鐘數。
 * profile 為 [里程 km, 海拔 m]，依里程排序；里程落在兩點之間時線性內插。
 */
export function paceFor(activity: Activity, profile: readonly (readonly [number, number])[]): Pace {
  const { speedKmh, climbMinPer100m } = ACTIVITY[activity];
  if (climbMinPer100m === 0 || profile.length < 2) return speedKmh;
  const kms = profile.map((p) => p[0]);
  const ascent: number[] = [0];
  for (let i = 1; i < profile.length; i++) ascent.push(ascent[i - 1]! + Math.max(0, profile[i]![1] - profile[i - 1]![1]));
  const ascentAt = (km: number) => {
    if (km <= kms[0]!) return 0;
    if (km >= kms[kms.length - 1]!) return ascent[ascent.length - 1]!;
    let lo = 0;
    let hi = kms.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (kms[mid]! <= km) lo = mid;
      else hi = mid;
    }
    const span = kms[hi]! - kms[lo]!;
    const f = span > 0 ? (km - kms[lo]!) / span : 0;
    return ascent[lo]! + Math.max(0, profile[hi]![1] - profile[lo]![1]) * f;
  };
  return (km: number) => km / speedKmh + (ascentAt(km) / 100) * (climbMinPer100m / 60);
}

export const ACTIVITIES = Object.keys(ACTIVITY) as Activity[];

/** 沒指定運動類型時依路線類型；雪巴運動（園區登山）視為健行，混合視為自行車 */
export function activityOfRouteType(type: Route["type"] | undefined): Activity {
  if (type === "跑步") return "running";
  if (type === "健行" || type === "雪巴運動") return "hiking";
  return "cycling";
}

export function parseActivity(value: string | null | undefined): Activity | null {
  return value && (ACTIVITIES as string[]).includes(value) ? (value as Activity) : null;
}

/** 早於現在 15 分鐘以上、晚於 7 天或無法解析的出發時間一律視為「現在」（回 null） */
const PAST_TOLERANCE_MS = 15 * 60_000;
const MAX_AHEAD_MS = 7 * 24 * 3_600_000;

export function parseDeparture(value: string | null | undefined, now: Date): Date | null {
  if (!value) return null;
  const t = Date.parse(value);
  if (Number.isNaN(t)) return null;
  if (t < now.getTime() - PAST_TOLERANCE_MS || t > now.getTime() + MAX_AHEAD_MS) return null;
  return new Date(t);
}

/** 出發選項：現在與幾小時後（整 10 分鐘） */
export const DEPARTURE_OFFSETS_H = [0, 1, 2, 3, 6] as const;

export function departureAfter(now: Date, hours: number): Date {
  if (hours === 0) return now;
  const t = now.getTime() + hours * 3_600_000;
  return new Date(Math.floor(t / 600_000) * 600_000);
}

const CLOCK = new Intl.DateTimeFormat("zh-TW", {
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "Asia/Taipei",
});
const DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" });

/** 台灣時間 HH:MM；不是 now 的同一天時加上「明日」或日期 */
export function formatClock(date: Date, now: Date): string {
  const clock = CLOCK.format(date);
  const day = DAY.format(date);
  if (day === DAY.format(now)) return clock;
  if (day === DAY.format(new Date(now.getTime() + 24 * 3_600_000))) return `明日 ${clock}`;
  return `${day.slice(5).replace("-", "/")} ${clock}`;
}

/** 某里程的預估到達時間（台灣時間字串），與判讀挑預報時段用同一組出發時間與行進速度 */
export function etaLabel(km: number, departure: string, pace: Pace, now: Date): string {
  return formatClock(estimateArrivalTime(km, new Date(departure), pace), now);
}

export interface TripParams {
  /** ISO 字串；未指定為現在 */
  depart?: string | null;
  activity?: Activity | null;
}

/** 在連結上帶著行程設定，換路線或換頁時不會被重設 */
export function withTrip(href: string, trip: TripParams): string {
  const params = new URLSearchParams();
  if (trip.depart) params.set("depart", trip.depart);
  if (trip.activity) params.set("activity", trip.activity);
  const qs = params.toString();
  if (!qs) return href;
  return `${href}${href.includes("?") ? "&" : "?"}${qs}`;
}

/**
 * 從記住的查詢字串（depart=&activity=）還原行程設定，給切頁回來時沿用。
 * 出發時間已過（或無法解析）時退回「現在」，運動類型不合法時退回依路線類型。
 */
export function restoreTrip(stored: string | null | undefined, now: Date): TripParams {
  if (!stored) return {};
  const params = new URLSearchParams(stored);
  const depart = parseDeparture(params.get("depart"), now);
  return { depart: depart ? params.get("depart") : null, activity: parseActivity(params.get("activity")) };
}
