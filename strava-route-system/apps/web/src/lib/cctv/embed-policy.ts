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
