/**
 * CWA 雷達合成回波：伺服器端列出歷史檔、把格點畫成透明 PNG
 * 資料放在 CWA 公開 S3（與 Vercel hnd1 同在東京），不需要金鑰。
 * 每筆 XML 約 9 MB，畫好的圖依時間戳快取：同一張圖內容不會再變，CDN 也能長期快取。
 * 只供顯示，不進判讀（briefing 不會呼叫這裡）。
 */

import sharp from "sharp";
import {
  RADAR_IMAGE_SIZE,
  historyDatePrefixes,
  latestRadarFrames,
  parseCompositeReflectivity,
  renderRadarRegion,
  type RadarFrame,
} from "@/lib/cwb/radar";

const BUCKET = "https://cwaopendata.s3.ap-northeast-1.amazonaws.com";
const HISTORY = "history/Observation/";
const LIST_TIMEOUT_MS = 10_000;
const FRAME_TIMEOUT_MS = 20_000;
/** 同一 instance 內重用清單的時間；CWA 每 10 分鐘出一張 */
const LIST_REUSE_MS = 60 * 1000;
/** 同一 instance 內留著的圖張數（一輪回放＋換場時的上一輪） */
const FRAME_CACHE_SIZE = 14;

let listCache: { frames: RadarFrame[]; fetchedAt: number } | null = null;
const frameCache = new Map<string, Promise<Buffer>>();

/** S3 ListObjectsV2 的物件名稱（一天約 300 筆，不會超過單頁 1000 筆） */
async function listKeys(prefix: string): Promise<string[]> {
  const url = `${BUCKET}/?list-type=2&prefix=${encodeURIComponent(prefix)}`;
  const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(LIST_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`雷達清單 ${res.status}`);
  const xml = await res.text();
  return [...xml.matchAll(/<Key>([^<]+)<\/Key>/g)].map((m) => m[1]!);
}

/** 最新一小時的雷達圖（舊到新）；觀測時間由呼叫端判斷是否過期 */
export async function listRadarFrames(now = Date.now()): Promise<RadarFrame[]> {
  if (listCache && now - listCache.fetchedAt < LIST_REUSE_MS) return listCache.frames;
  const keys = (await Promise.all(historyDatePrefixes(now).map((d) => listKeys(`${HISTORY}${d}`)))).flat();
  const frames = latestRadarFrames(keys);
  listCache = { frames, fetchedAt: now };
  return frames;
}

async function renderFrame(id: string): Promise<Buffer> {
  const res = await fetch(`${BUCKET}/${HISTORY}${id}compref_mosaic.xml`, {
    cache: "no-store",
    signal: AbortSignal.timeout(FRAME_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`雷達格點 ${id} ${res.status}`);
  const { values } = parseCompositeReflectivity(await res.text());
  const { width, height } = RADAR_IMAGE_SIZE;
  // 色階不到 60 色，調色盤 PNG 不失真，一張通常幾十 KB
  return sharp(renderRadarRegion(values), { raw: { width, height, channels: 4 } })
    .png({ palette: true, colors: 256, dither: 0, compressionLevel: 9 })
    .toBuffer();
}

/** 某個時間戳的雷達圖（透明 PNG，範圍見 RADAR_EXTENT）；同時間的請求共用一次下載 */
export function getRadarFramePng(id: string): Promise<Buffer> {
  const hit = frameCache.get(id);
  if (hit) return hit;
  const job = renderFrame(id);
  frameCache.set(id, job);
  // 失敗不留快取；超過張數時丟最舊的
  job.catch(() => frameCache.delete(id));
  while (frameCache.size > FRAME_CACHE_SIZE) frameCache.delete(frameCache.keys().next().value!);
  return job;
}
