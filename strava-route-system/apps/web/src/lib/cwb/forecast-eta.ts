/**
 * 依預估抵達時間（ETA）挑選 CWB 降雨機率、風速、天氣現象時段
 * 不依賴 React 與伺服器，Dashboard 判讀與路線偵察共用。
 */

/**
 * 估算 ETA 用的平均速度（km/h）。以一般公路車休閒騎乘的均速為準（含停等）。
 * 運動類型的均速與爬升修正見 lib/routes/trip.ts。
 */
export const DEFAULT_CYCLING_SPEED_KMH = 20;

/**
 * 行進速度：數字為均速（km/h），函式為「從起點到某里程所需小時數」（例：健行依爬升加時間）。
 */
export type Pace = number | ((km: number) => number);

const hoursTo = (km: number, pace: Pace) => (typeof pace === "number" ? km / pace : pace(km));

export interface RainfallBucket {
  startTime: string;
  endTime: string;
  pop: number;
  label: string;
  endLabel: string;
}

export function estimateArrivalTime(km: number, departure: Date, pace: Pace = DEFAULT_CYCLING_SPEED_KMH): Date {
  return new Date(departure.getTime() + hoursTo(km, pace) * 3_600_000);
}

/**
 * 途中模式：已在路線上第 fromKm 公里時，反推「虛擬出發時間」＝ now − 起點到 fromKm 所需時間。
 * 之後前方第 k 公里的 ETA ＝ now ＋（hoursTo(k) − hoursTo(fromKm)），可直接沿用依出發時間挑預報時段的所有函式。
 * 不能用「剩餘距離 ÷ 均速」：健行的爬升修正依里程累計，從中途起算會算錯。
 */
export function departureForPosition(now: Date, fromKm: number, pace: Pace = DEFAULT_CYCLING_SPEED_KMH): Date {
  return new Date(now.getTime() - hoursTo(Math.max(0, fromKm), pace) * 3_600_000);
}

/**
 * 涵蓋 ETA 的時段；ETA 早於所有時段取第一個未來時段。
 * 晚於所有時段回傳 null：超出預報時段不可拿其他時段頂替（判讀端改判 unknown）。
 * 時間無法解析的時段略過；沒有可用時段回傳 null。
 */
export function pickRainfallBucketByEta<T extends Pick<RainfallBucket, "startTime" | "endTime">>(
  eta: Date,
  buckets: readonly T[]
): T | null {
  const t = eta.getTime();
  const valid = buckets.filter((b) => !Number.isNaN(Date.parse(b.startTime)) && !Number.isNaN(Date.parse(b.endTime)));
  return (
    valid.find((b) => t >= Date.parse(b.startTime) && t < Date.parse(b.endTime)) ??
    valid.find((b) => Date.parse(b.startTime) > t) ??
    null
  );
}

type TimedPop = Pick<RainfallBucket, "startTime" | "endTime" | "pop">;

/**
 * 路段騎經時間（進入 ETA ～ 離開 ETA）重疊的時段中，降雨機率最高的一個；
 * 長路段可能橫跨兩個時段，取較保守者。沒有重疊時退回進入 ETA 的時段。
 */
export function pickRainfallBucketForSegment<T extends TimedPop>(
  sampleKms: readonly number[] | undefined,
  departure: Date,
  buckets: readonly T[],
  pace: Pace = DEFAULT_CYCLING_SPEED_KMH
): T | null {
  if (isBeyondForecast(sampleKms, departure, buckets, pace)) return null;
  const entryKm = sampleKms?.[0] ?? 0;
  const exitKm = sampleKms?.[sampleKms.length - 1] ?? entryKm;
  const from = estimateArrivalTime(entryKm, departure, pace).getTime();
  const to = estimateArrivalTime(exitKm, departure, pace).getTime();
  const overlapping = buckets.filter((b) => {
    const start = Date.parse(b.startTime);
    const end = Date.parse(b.endTime);
    return start <= to && end > from;
  });
  if (overlapping.length === 0) return pickRainfallBucketByEta(new Date(from), buckets);
  return overlapping.reduce((a, b) => (b.pop > a.pop ? b : a));
}

/**
 * 路段離開時的 ETA 已超出最後一個預報時段（含部分超出）。
 * 沒有可用時段時回 false，由「無資料」處理。
 */
export function isBeyondForecast(
  sampleKms: readonly number[] | undefined,
  departure: Date,
  buckets: readonly Pick<RainfallBucket, "endTime">[],
  pace: Pace = DEFAULT_CYCLING_SPEED_KMH
): boolean {
  const ends = buckets.map((b) => Date.parse(b.endTime)).filter((t) => !Number.isNaN(t));
  if (ends.length === 0) return false;
  const exitKm = sampleKms?.[sampleKms.length - 1] ?? sampleKms?.[0] ?? 0;
  return estimateArrivalTime(exitKm, departure, pace).getTime() >= Math.max(...ends);
}

/** 風速時段（km/h） */
export interface WindBucket {
  startTime: string;
  endTime: string;
  kmh: number;
}

type CwbTime = { StartTime?: string; EndTime?: string; DataTime?: string; ElementValue?: Array<Record<string, string>> };

/**
 * CWB 時段元素 → [起, 迄, 值]。
 * 有 StartTime／EndTime 時直接用；只有 DataTime（時間點）時，以到下一個時間點為一段，最後一段沿用前一段長度（預設 3 小時）。
 * 時間無法解析或 read 回傳 null（數值缺漏）的略過。
 */
function timedValuesFromCwb<V>(
  times: readonly CwbTime[] | undefined,
  read: (v: Record<string, string> | undefined) => V | null
): { startTime: string; endTime: string; value: V }[] {
  if (!times?.length) return [];
  const points = times
    .map((t) => ({ start: t.StartTime ?? t.DataTime, end: t.EndTime, value: read(t.ElementValue?.[0]) }))
    .filter((p): p is { start: string; end: string | undefined; value: V } =>
      !!p.start && !Number.isNaN(Date.parse(p.start)) && p.value !== null
    );
  return points.map((p, i) => {
    let end = p.end;
    if (!end || Number.isNaN(Date.parse(end))) {
      const next = points[i + 1]?.start;
      const prev = points[i - 1]?.start;
      const step = next ? Date.parse(next) - Date.parse(p.start) : prev ? Date.parse(p.start) - Date.parse(prev) : 3 * 3_600_000;
      end = new Date(Date.parse(p.start) + step).toISOString();
    }
    return { startTime: p.start, endTime: end, value: p.value };
  });
}

/** CWB「風速」元素 → 時段。風速（m/s）換算 km/h。 */
export function windBucketsFromCwb(times: readonly CwbTime[] | undefined): WindBucket[] {
  return timedValuesFromCwb(times, (v) => {
    const ms = parseFloat(v?.WindSpeed ?? v?.value ?? "");
    return Number.isFinite(ms) ? ms : null;
  }).map(({ startTime, endTime, value }) => ({ startTime, endTime, kmh: Math.round(value * 3.6) }));
}

/** 天氣現象時段，例：「短暫陣雨」「多雲時陰短暫雨」「午後短暫雷陣雨」 */
export interface WeatherTextBucket {
  startTime: string;
  endTime: string;
  text: string;
}

/** CWB「天氣現象」元素 → 時段；空字串略過 */
export function weatherTextBucketsFromCwb(times: readonly CwbTime[] | undefined): WeatherTextBucket[] {
  return timedValuesFromCwb(times, (v) => {
    const text = (v?.Weather ?? v?.value ?? "").trim();
    return text ? text : null;
  }).map(({ startTime, endTime, value }) => ({ startTime, endTime, text: value }));
}

/** 路段進入 ETA ～ 離開 ETA 的時間區間（ms） */
function segmentWindow(sampleKms: readonly number[] | undefined, departure: Date, pace: Pace): [from: number, to: number] {
  const entryKm = sampleKms?.[0] ?? 0;
  const exitKm = sampleKms?.[sampleKms.length - 1] ?? entryKm;
  return [estimateArrivalTime(entryKm, departure, pace).getTime(), estimateArrivalTime(exitKm, departure, pace).getTime()];
}

/**
 * 路段行經時間重疊的所有天氣現象（去重、依時間排序）；沒有重疊時取進入 ETA 所在或之後的第一個時段。
 * 判讀只拿來擋降級（有雷、大雨就不降），所以全部列出，不挑其中一個。
 */
export function pickWeatherTextsForSegment(
  sampleKms: readonly number[] | undefined,
  departure: Date,
  buckets: readonly WeatherTextBucket[],
  pace: Pace = DEFAULT_CYCLING_SPEED_KMH
): string[] {
  if (buckets.length === 0) return [];
  const [from, to] = segmentWindow(sampleKms, departure, pace);
  const overlapping = buckets.filter((b) => Date.parse(b.startTime) <= to && Date.parse(b.endTime) > from);
  const picked = overlapping.length > 0 ? overlapping : [pickRainfallBucketByEta(new Date(from), buckets)].filter((b) => b != null);
  return [...new Set(picked.map((b) => b.text))];
}

/**
 * 路段行經時間（進入 ETA ～ 離開 ETA）重疊的風速時段中最大者（較保守）；
 * 沒有重疊時取進入 ETA 所在或之後的第一個時段；都沒有回傳 null（由呼叫端退回第一個時段）。
 */
export function pickWindForSegment(
  sampleKms: readonly number[] | undefined,
  departure: Date,
  buckets: readonly WindBucket[],
  pace: Pace = DEFAULT_CYCLING_SPEED_KMH
): number | null {
  if (buckets.length === 0) return null;
  const entryKm = sampleKms?.[0] ?? 0;
  const exitKm = sampleKms?.[sampleKms.length - 1] ?? entryKm;
  const from = estimateArrivalTime(entryKm, departure, pace).getTime();
  const to = estimateArrivalTime(exitKm, departure, pace).getTime();
  const overlapping = buckets.filter((b) => Date.parse(b.startTime) <= to && Date.parse(b.endTime) > from);
  if (overlapping.length > 0) return Math.max(...overlapping.map((b) => b.kmh));
  return pickRainfallBucketByEta(new Date(from), buckets)?.kmh ?? null;
}
