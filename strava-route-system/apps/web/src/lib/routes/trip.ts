/**
 * 行程設定：出發時間與運動類型 → 估算各段預估到達時間（ETA）用的均速。
 * 純函式，不依賴 React 與伺服器；今日判讀、路線頁與 API 共用。
 */

import type { Route } from "@/lib/routes/route-data";
import { DEFAULT_CYCLING_SPEED_KMH, estimateArrivalTime, type Pace } from "@/lib/cwb/forecast-eta";

export type Activity = "cycling" | "running" | "hiking";

/**
 * 均速為平路含停等的規則式估算；三種運動都另依累計爬升加時間（下坡不扣，偏保守）：
 * - 健行：Naismith 規則，每爬升 600 m 加 1 小時，即每 100 m 加 10 分鐘。
 * - 自行車：休閒車友爬坡的垂直爬升率（VAM）約 700 m/h，爬 100 m 約 8.6 分鐘；
 *   同一段在常見 6% 坡度約 1.7 km，平路 20 km/h 騎完要 5 分鐘，差額約 3.6 分鐘 → 每 100 m 加 4 分鐘。
 * - 跑步：越野跑常用的「努力公里」（ITRA km-effort）每爬升 100 m 折合 1 km 平路，
 *   以 10 km/h 計為 6 分鐘 → 每 100 m 加 6 分鐘。
 */
export const ACTIVITY: Record<Activity, { label: string; speedKmh: number; climbMinPer100m: number }> = {
  cycling: { label: "自行車", speedKmh: DEFAULT_CYCLING_SPEED_KMH, climbMinPer100m: 4 },
  running: { label: "跑步", speedKmh: 10, climbMinPer100m: 6 },
  hiking: { label: "健行", speedKmh: 4, climbMinPer100m: 10 },
};

/**
 * 使用者自訂的平地均速：滑桿範圍與刻度（程度）。超出範圍視為打錯，退回預設均速。
 * 「一般」等於 ACTIVITY 的預設均速。
 */
export const SPEED_RANGE: Record<Activity, { min: number; max: number; step: number }> = {
  cycling: { min: 12, max: 35, step: 1 },
  running: { min: 6, max: 15, step: 0.5 },
  hiking: { min: 2, max: 6, step: 0.5 },
};

export const SPEED_LEVELS: Record<Activity, readonly { label: string; speedKmh: number }[]> = {
  cycling: [
    { label: "輕鬆", speedKmh: 15 },
    { label: "一般", speedKmh: 20 },
    { label: "進階", speedKmh: 25 },
    { label: "競速", speedKmh: 30 },
  ],
  running: [
    { label: "輕鬆", speedKmh: 8 },
    { label: "一般", speedKmh: 10 },
    { label: "進階", speedKmh: 12 },
  ],
  hiking: [
    { label: "輕鬆", speedKmh: 3 },
    { label: "一般", speedKmh: 4 },
    { label: "進階", speedKmh: 5 },
  ],
};

/** 各運動自訂的平地均速；沒有的運動用預設均速 */
export type SpeedPrefs = Partial<Record<Activity, number>>;

/** 自訂均速存在 cookie（伺服器頁面與今日判讀也讀得到），格式 cycling:25,hiking:3.5 */
export const SPEED_COOKIE = "dawnline-speed";

/** 自訂均速：在範圍內才接受，並對齊刻度；其餘（含等於預設值）回 null 代表用預設 */
export function parseSpeed(activity: Activity, value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  const { min, max, step } = SPEED_RANGE[activity];
  if (!Number.isFinite(n) || n < min || n > max) return null;
  const snapped = Math.round(n / step) * step;
  return snapped === ACTIVITY[activity].speedKmh ? null : snapped;
}

export function parseSpeedPrefs(value: string | null | undefined): SpeedPrefs {
  const prefs: SpeedPrefs = {};
  for (const part of (value ?? "").split(",")) {
    const [key, raw] = part.split(":");
    const activity = parseActivity(key?.trim());
    const speed = activity ? parseSpeed(activity, raw) : null;
    if (activity && speed != null) prefs[activity] = speed;
  }
  return prefs;
}

export function serializeSpeedPrefs(prefs: SpeedPrefs): string {
  return ACTIVITIES.filter((a) => prefs[a] != null)
    .map((a) => `${a}:${prefs[a]}`)
    .join(",");
}

/** 實際採用的平地均速：自訂（合法時）優先，否則為預設 */
export function speedFor(activity: Activity, custom?: number | null): number {
  return (custom != null ? parseSpeed(activity, custom) : null) ?? ACTIVITY[activity].speedKmh;
}

/** 速度標籤：剛好在某個程度上顯示程度名稱，否則為「自訂」 */
export function speedLevelLabel(activity: Activity, speedKmh: number): string {
  return SPEED_LEVELS[activity].find((l) => l.speedKmh === speedKmh)?.label ?? "自訂";
}

/**
 * 每爬升 100 m 加的分鐘數，隨平地均速等比例縮放（騎得快的人爬坡通常也快）：
 * 等同「每 100 m 爬升折合固定的平路距離」，預設均速時就是 ACTIVITY 的 climbMinPer100m。
 */
export function climbMinFor(activity: Activity, speedKmh: number = ACTIVITY[activity].speedKmh): number {
  const { speedKmh: base, climbMinPer100m } = ACTIVITY[activity];
  return (climbMinPer100m * base) / speedKmh;
}

/**
 * 行進速度：不加爬升時就是均速；加爬升時回傳「起點到某里程所需小時數」＝ 距離 ÷ 均速 ＋ 累計爬升 × 每 100 m 分鐘數。
 * profile 為 [里程 km, 海拔 m]，依里程排序；里程落在兩點之間時線性內插。
 * speedKmh 為平地均速（使用者自訂或預設），爬升加時依 climbMinFor 隨之縮放。
 */
export function paceFor(
  activity: Activity,
  profile: readonly (readonly [number, number])[],
  speedKmh: number = ACTIVITY[activity].speedKmh
): Pace {
  const climbMinPer100m = climbMinFor(activity, speedKmh);
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

/** 整條路線的預估時間，拆成平地與爬升兩部分（小時）；畫面顯示「預估 X（含爬升 Y）」用 */
export function tripDuration(
  activity: Activity,
  profile: readonly (readonly [number, number])[],
  totalKm: number,
  speedKmh: number = ACTIVITY[activity].speedKmh
): { flatHours: number; climbHours: number } {
  const pace = paceFor(activity, profile, speedKmh);
  const flatHours = totalKm / speedKmh;
  const total = typeof pace === "number" ? flatHours : pace(totalKm);
  return { flatHours, climbHours: Math.max(0, total - flatHours) };
}

/** 時長：1h 41m／25m（與路線卡既有格式相同） */
export function formatDuration(hours: number): string {
  const minutes = Math.round(hours * 60);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
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

/** 途中模式的目前里程參數：非負有限數字才接受，其餘視為未提供（整條路線判讀） */
export function parseFromKm(value: string | null | undefined): number | null {
  if (!value) return null;
  const km = Number(value);
  return Number.isFinite(km) && km >= 0 ? km : null;
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

/** 頁面層的行程設定：網址上的出發時間、運動類型，加上 cookie 裡的自訂均速 */
export interface PageTrip {
  depart: string | null;
  activity: Activity | null;
  speeds?: SpeedPrefs;
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
