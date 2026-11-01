/**
 * 未登入時公開路線的自訂順序存在 cookie：今日判讀（伺服器頁面）讀得到，下次開也沿用。
 * 只在瀏覽器端呼叫；儲存被封鎖時回 false，由呼叫端提示（順序回到預設）。
 */

import { PUBLIC_ORDER_COOKIE, serializeOrderCookie } from "@/lib/dashboard/route-order";

const MAX_AGE_S = 365 * 24 * 3600;

export function savePublicOrder(ids: readonly string[]): boolean {
  try {
    document.cookie = `${PUBLIC_ORDER_COOKIE}=${encodeURIComponent(serializeOrderCookie(ids))}; path=/; max-age=${MAX_AGE_S}; samesite=lax`;
    return true;
  } catch {
    return false;
  }
}
