/** 途中模式持續定位的純邏輯：何時重新判讀。不碰瀏覽器 API。 */

/** 移動超過此距離（km）才重新判讀：比定位誤差（≤ 0.2 km）大，避免 GPS 飄移一直重抓 */
export const RIDE_REBRIEF_MIN_KM = 0.5;
/** 距上次判讀超過此時間（ms）就重新判讀：站著不動時預報時段與即時雨量仍會變 */
export const RIDE_REBRIEF_MAX_AGE_MS = 5 * 60_000;

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
