/**
 * CCTV 鏡頭網址來源統計（純函式）
 * 用來評估探測值不值得做：各網域、各縣市有多少鏡頭是可直接探測的影像，多少是播放頁
 */

import { isProbeableUrl } from "@/lib/cctv/probe-status";

export type CctvSourceInput = { videoUrl?: string; county?: string };

export type CctvHostStat = {
  host: string;
  count: number;
  /** 網域本身不在「無法探測」清單，且是公開 http(s)；實際能否探測要看回應 content-type */
  probeable: boolean;
  /** 網址路徑看起來像直接影像（.jpg／.mjpg／.m3u8 等），不是 HTML 頁 */
  looksLikeMedia: number;
  sampleUrl: string;
};

export type CctvSourceStats = {
  total: number;
  /** 沒有網址的鏡頭數 */
  missingUrl: number;
  byHost: CctvHostStat[];
  byCounty: { county: string; total: number; probeable: number }[];
};

const MEDIA_PATH = /\.(jpe?g|png|mjpe?g|cgi|m3u8|ts|flv)$|mjpg|snapshot|stream/i;

export function summarizeCctvSources(items: CctvSourceInput[]): CctvSourceStats {
  const hosts = new Map<string, CctvHostStat>();
  const counties = new Map<string, { total: number; probeable: number }>();
  let missingUrl = 0;

  for (const item of items) {
    const county = item.county || "未知";
    const c = counties.get(county) ?? { total: 0, probeable: 0 };
    c.total++;
    counties.set(county, c);

    const host = hostOf(item.videoUrl);
    if (!host) {
      missingUrl++;
      continue;
    }
    const probeable = isProbeableUrl(item.videoUrl);
    if (probeable) c.probeable++;

    const h = hosts.get(host) ?? { host, count: 0, probeable, looksLikeMedia: 0, sampleUrl: item.videoUrl! };
    h.count++;
    if (MEDIA_PATH.test(new URL(item.videoUrl!).pathname)) h.looksLikeMedia++;
    hosts.set(host, h);
  }

  return {
    total: items.length,
    missingUrl,
    byHost: [...hosts.values()].sort((a, b) => b.count - a.count),
    byCounty: [...counties.entries()]
      .map(([county, v]) => ({ county, ...v }))
      .sort((a, b) => b.total - a.total),
  };
}

function hostOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}
