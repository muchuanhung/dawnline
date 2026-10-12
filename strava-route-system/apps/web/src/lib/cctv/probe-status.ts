/**
 * CCTV 連線狀態判定（純函式）
 * 輸入：同一台鏡頭最近幾次的探測紀錄；輸出：online／degraded／offline／unknown
 * 鐵律：沒探測過、紀錄過期、無法探測的來源一律 unknown，不可判成 online
 */

export type CctvProbeStatus = "online" | "degraded" | "offline" | "unknown";

/**
 * 單次探測結果
 * - ok：HTTP 2xx 且收到影像（JPEG、MJPEG 的第一個影格，或 HLS playlist）
 * - fail：逾時、4xx／5xx、DNS 錯誤、回來的不是影像
 * - unprobeable：來源是 HTML 播放頁等無法判斷影格的格式
 */
export type ProbeOutcome = "ok" | "fail" | "unprobeable";

export type ProbeAttempt = {
  /** 探測時間（epoch ms） */
  at: number;
  outcome: ProbeOutcome;
  /** 從發出請求到收到第一個影格的毫秒數（只有 ok 才有） */
  firstFrameMs?: number;
  /** 第一個影格的 hash，用來判斷畫面凍結（只有 JPEG／MJPEG 才有） */
  frameHash?: string;
};

/** 快取期間內不重新探測 */
export const PROBE_CACHE_MS = 5 * 60_000;
/** 最新紀錄超過這個時間就視為過期 → unknown */
export const PROBE_STALE_MS = 10 * 60_000;
/** 第一個影格超過這個時間才到 → degraded */
export const FIRST_FRAME_SLOW_MS = 3_000;
/** 單次探測逾時；超過就算 fail */
export const PROBE_TIMEOUT_MS = 5_000;
/** 每台鏡頭保留的探測紀錄筆數 */
export const PROBE_HISTORY_SIZE = 3;

/** 新紀錄放最前面，只保留最近 PROBE_HISTORY_SIZE 筆 */
export function appendProbeAttempt(history: ProbeAttempt[], attempt: ProbeAttempt): ProbeAttempt[] {
  return [attempt, ...sortNewestFirst(history)].slice(0, PROBE_HISTORY_SIZE);
}

/** 最新紀錄仍在快取期間內時，不必重新探測 */
export function isProbeFresh(history: ProbeAttempt[], now: number): boolean {
  const latest = sortNewestFirst(history)[0];
  return latest != null && now - latest.at < PROBE_CACHE_MS;
}

/** 依探測紀錄判定狀態 */
export function classifyProbeHistory(history: ProbeAttempt[], now: number): CctvProbeStatus {
  const recent = sortNewestFirst(history).slice(0, PROBE_HISTORY_SIZE);
  const [latest, previous] = recent;

  // 沒探測過，或最新紀錄已過期：不知道就是不知道
  if (!latest || now - latest.at > PROBE_STALE_MS) return "unknown";
  if (latest.outcome === "unprobeable") return "unknown";

  if (latest.outcome === "fail") {
    // 連續 2 次失敗才判離線；只失敗 1 次可能是暫時性問題，維持 unknown
    return previous?.outcome === "fail" ? "offline" : "unknown";
  }

  // 以下 latest 為 ok
  if (latest.firstFrameMs != null && latest.firstFrameMs > FIRST_FRAME_SLOW_MS) return "degraded";
  if (recent.some((a) => a.outcome === "fail")) return "degraded";
  // 連兩次抓到完全相同的影格：畫面凍結
  if (
    previous?.outcome === "ok" &&
    latest.frameHash != null &&
    latest.frameHash === previous.frameHash
  ) {
    return "degraded";
  }
  return "online";
}

function sortNewestFirst(history: ProbeAttempt[]): ProbeAttempt[] {
  return [...history].sort((a, b) => b.at - a.at);
}

/** 已知是 HTML 播放頁、不必發請求就知道無法探測的來源 */
export const UNPROBEABLE_DOMAINS = ["tw.live", "hls.bote.gov.taipei"];

/**
 * 是否值得對這個網址發探測請求
 * 只探 http(s)；擋掉 localhost 與私有網段，避免資料被竄改時伺服器去打內網
 */
export function isProbeableUrl(url: string | undefined): boolean {
  if (!url) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  const host = parsed.hostname.toLowerCase();
  if (UNPROBEABLE_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`))) return false;
  return !isPrivateHost(host);
}

function isPrivateHost(host: string): boolean {
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal")) return true;
  // IPv6 literal（含 ::1）一律不探；TDX 鏡頭不會用 IPv6 literal
  if (host.startsWith("[")) return true;
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127)
  );
}
