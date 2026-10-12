/**
 * CCTV iframe 嵌入政策（X-Frame-Options／CSP、並發上限、白邊裁切）
 * cctv-gallery 與路線偵察畫面共用
 */

/** 來源設有 X-Frame-Options／CSP，iframe 會空白，只能外連 */
export const BLOCKED_IFRAME_DOMAINS = ["atis.ntpc.gov.tw", "tw.live"];

/** 需限制並發 iframe 數量，且頁面有白邊（用 scale 裁切隱藏） */
export const RATE_LIMITED_IFRAME_DOMAINS = ["hls.bote.gov.taipei"];

function hostMatches(url: string | undefined, domains: string[]): boolean {
  if (!url) return false;
  try {
    const host = new URL(url).hostname;
    return domains.some((d) => host === d || host.endsWith(`.${d}`));
  } catch {
    return false;
  }
}

export function isBlockedByCSP(url: string | undefined): boolean {
  return hostMatches(url, BLOCKED_IFRAME_DOMAINS);
}

export function isRateLimited(url: string | undefined): boolean {
  return hostMatches(url, RATE_LIMITED_IFRAME_DOMAINS);
}

export function hasWhiteBorderInEmbed(url: string | undefined): boolean {
  return hostMatches(url, RATE_LIMITED_IFRAME_DOMAINS);
}

/**
 * 新北 ATIS 鏡頭：外框頁（ShowFrame4CCTV）禁止內嵌，但頁內實際影像是 HTTP-FLV 串流，
 * 可由伺服器查出串流網址後在前端用 mpegts.js 播放。回傳鏡頭 ID（例：C000236），不是 ATIS 網址回傳 null
 */
export function atisCctvId(url: string | undefined): string | null {
  if (!url || !hostMatches(url, ["atis.ntpc.gov.tw"])) return null;
  const match = new URL(url).pathname.match(/\/ShowFrame4CCTV\/(C\d{6})\/?$/i);
  return match ? match[1]!.toUpperCase() : null;
}

/** ATIS 查詢 API 回傳的串流網址只接受新北 CCTV 主機的 https FLV，避免把任意網址交給播放器 */
export function isAtisFlvUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const u = new URL(url);
    return u.protocol === "https:" && /^cctvatis\d*\.ntpc\.gov\.tw$/.test(u.hostname) && u.pathname.startsWith("/flv/");
  } catch {
    return false;
  }
}
