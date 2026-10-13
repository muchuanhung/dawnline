/**
 * CCTV 探測（伺服器端）：對鏡頭 videoUrl 發一次請求，回傳 ProbeAttempt
 * - image/*：讀完整張圖當第一個影格
 * - multipart/x-mixed-replace（MJPEG）：讀到第一張 JPEG 結尾（FF D9）就中斷
 * - HLS（.m3u8）：確認 playlist 開頭是 #EXTM3U；不下載 segment，也不算 hash
 * - text/html：播放頁，無法判斷影格 → unprobeable
 */

import { createHash } from "node:crypto";
import { PROBE_TIMEOUT_MS, isProbeableUrl, type ProbeAttempt } from "@/lib/cctv/probe-status";

/** 401 未授權、403 禁止（含擋海外 IP）、451 法律因素拒絕 */
const ACCESS_DENIED_STATUSES = new Set([401, 403, 451]);

/** 單張影格最多讀這麼多，避免被超大回應拖住 */
const MAX_FRAME_BYTES = 2 * 1024 * 1024;

export async function probeCctvUrl(url: string | undefined): Promise<ProbeAttempt> {
  const startedAt = Date.now();
  if (!isProbeableUrl(url)) return { at: startedAt, outcome: "unprobeable" };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetchFollowingSafeRedirects(url!, controller.signal);
    if (!res) return { at: startedAt, outcome: "unprobeable" };
    // 主機有回應但拒絕存取或擋地區：鏡頭可能正常，只是不讓伺服器看 → 無法判斷
    if (ACCESS_DENIED_STATUSES.has(res.status)) {
      res.body?.cancel().catch(() => {});
      return { at: startedAt, outcome: "unprobeable" };
    }
    if (!res.ok || !res.body) return fail(startedAt, res.body);

    const contentType = (res.headers.get("content-type") ?? "").toLowerCase();
    const reader = res.body.getReader();
    try {
      if (contentType.includes("text/html")) return { at: startedAt, outcome: "unprobeable" };

      if (contentType.startsWith("multipart/x-mixed-replace")) {
        const frame = await readFirstJpeg(reader);
        if (!frame) return { at: startedAt, outcome: "fail" };
        return ok(startedAt, frame);
      }

      if (contentType.startsWith("image/")) {
        const frame = await readAll(reader);
        if (!frame || frame.length === 0) return { at: startedAt, outcome: "fail" };
        return ok(startedAt, frame);
      }

      if (isHlsContentType(contentType) || new URL(res.url || url!).pathname.endsWith(".m3u8")) {
        const head = await readAll(reader, 4096, true);
        const text = head ? new TextDecoder().decode(head) : "";
        if (!text.trimStart().startsWith("#EXTM3U")) return { at: startedAt, outcome: "fail" };
        return { at: startedAt, outcome: "ok", firstFrameMs: Date.now() - startedAt };
      }

      // 回來的不是影像
      return { at: startedAt, outcome: "fail" };
    } finally {
      // MJPEG 是無止盡串流，讀完第一張一定要中斷連線
      reader.cancel().catch(() => {});
    }
  } catch {
    // 逾時（abort）、DNS 錯誤、連線失敗
    return { at: startedAt, outcome: "fail" };
  } finally {
    clearTimeout(timer);
  }
}

/** 最多跟幾次轉址 */
const MAX_REDIRECTS = 3;

/**
 * 手動跟轉址，每一跳都重新檢查網址，避免外部鏡頭網址轉到內網
 * 轉到不可探測的網址時回 null
 */
async function fetchFollowingSafeRedirects(url: string, signal: AbortSignal): Promise<Response | null> {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!isProbeableUrl(current)) return null;
    const res = await fetch(current, {
      signal,
      redirect: "manual",
      cache: "no-store",
      headers: { "User-Agent": "Dawnline-CCTV-Probe/1.0" },
    });
    const location = res.headers.get("location");
    if (res.status < 300 || res.status >= 400 || !location) return res;
    res.body?.cancel().catch(() => {});
    current = new URL(location, current).toString();
  }
  // 轉址太多次視為失敗：回一個非 2xx 的空回應
  return new Response(null, { status: 508 });
}

function ok(startedAt: number, frame: Uint8Array): ProbeAttempt {
  return {
    at: startedAt,
    outcome: "ok",
    firstFrameMs: Date.now() - startedAt,
    frameHash: createHash("sha1").update(frame).digest("hex"),
  };
}

function fail(startedAt: number, body: ReadableStream<Uint8Array> | null): ProbeAttempt {
  body?.cancel().catch(() => {});
  return { at: startedAt, outcome: "fail" };
}

function isHlsContentType(contentType: string): boolean {
  return contentType.includes("mpegurl");
}

type Reader = ReadableStreamDefaultReader<Uint8Array>;

/** 讀到串流結束或超過上限；超過上限時 truncate 就回前 limit bytes，否則回 null */
async function readAll(reader: Reader, limit = MAX_FRAME_BYTES, truncate = false): Promise<Uint8Array | null> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.length;
    if (size > limit) return truncate ? concat(chunks, size).slice(0, limit) : null;
  }
  return concat(chunks, size);
}

/** 從 MJPEG 串流取出第一張完整 JPEG（SOI FF D8 到 EOI FF D9） */
async function readFirstJpeg(reader: Reader): Promise<Uint8Array | null> {
  let buf: Uint8Array = new Uint8Array(0);
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return null;
    buf = concat([buf, value], buf.length + value.length);
    if (buf.length > MAX_FRAME_BYTES) return null;
    const start = indexOfMarker(buf, 0xd8, 0);
    if (start < 0) continue;
    const end = indexOfMarker(buf, 0xd9, start + 2);
    if (end >= 0) return buf.slice(start, end + 2);
  }
}

/** 找 0xFF 後接指定 byte 的位置 */
function indexOfMarker(buf: Uint8Array, marker: number, from: number): number {
  for (let i = from; i < buf.length - 1; i++) {
    if (buf[i] === 0xff && buf[i + 1] === marker) return i;
  }
  return -1;
}

function concat(chunks: Uint8Array[], size: number): Uint8Array {
  const out = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}
