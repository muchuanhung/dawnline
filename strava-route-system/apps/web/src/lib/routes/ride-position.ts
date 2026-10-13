/**
 * 途中模式持續定位的純邏輯：何時重新判讀、記住的里程何時還能用。
 * 不碰瀏覽器 API；儲存讀寫見 ride-position-storage.ts。
 */

/** 移動超過此距離（km）才重新判讀：比定位誤差（≤ 0.2 km）大，避免 GPS 飄移一直重抓 */
export const RIDE_REBRIEF_MIN_KM = 0.5;
/** 距上次判讀超過此時間（ms）就重新判讀：站著不動時預報時段與即時雨量仍會變 */
export const RIDE_REBRIEF_MAX_AGE_MS = 5 * 60_000;
/** 記住的里程超過此時間（ms）不再自動套用：人早就往前走了，用舊里程估 ETA 會偏晚 */
export const RIDE_REMEMBER_TTL_MS = 2 * 60 * 60_000;

export interface AppliedKm {
  km: number;
  /** 套用時間（epoch ms） */
  at: number;
}

/** 新定位出的里程要不要觸發重新判讀：第一次、移動夠遠或距上次夠久才要 */
export function shouldRebrief(last: AppliedKm | null, km: number, now: number): boolean {
  if (!last) return true;
  if (Math.abs(km - last.km) >= RIDE_REBRIEF_MIN_KM) return true;
  return now - last.at >= RIDE_REBRIEF_MAX_AGE_MS;
}

/**
 * 解析記住的里程（JSON {km, at}）。格式錯誤、未來時間、超過 TTL、超出路線總里程都回 null，不猜。
 */
export function parseRememberedKm(raw: string | null, now: number, totalKm: number): AppliedKm | null {
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const { km, at } = value as Record<string, unknown>;
  if (typeof km !== "number" || typeof at !== "number" || !Number.isFinite(km) || !Number.isFinite(at)) return null;
  if (km < 0 || km > totalKm) return null;
  const age = now - at;
  if (age < 0 || age > RIDE_REMEMBER_TTL_MS) return null;
  return { km, at };
}
