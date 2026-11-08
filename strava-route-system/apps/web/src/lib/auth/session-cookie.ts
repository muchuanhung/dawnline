/**
 * 從原始 Cookie header 取出指定 cookie 的值（純函式，server.ts 與單元測試共用）。
 * 只比對完整的 cookie 名稱（`xfirebase-id-token` 不算）；值的百分比編碼壞掉時視為沒有這個 cookie，
 * 不讓 decodeURIComponent 的 URIError 把整個頁面變成 500。
 */
export function readCookie(cookieHeader: string, name: string): string | null {
  for (const part of cookieHeader.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0 || part.slice(0, eq).trim() !== name) continue;
    const raw = part.slice(eq + 1).trim();
    if (!raw) return null;
    try {
      return decodeURIComponent(raw);
    } catch {
      return null;
    }
  }
  return null;
}
