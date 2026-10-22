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
  nowcastFrameId,
  nowcastStamp,
  observedAtOfFrameId,
  parseCompositeReflectivity,
  parseRainNowcast,
  renderNowcastRegion,
  renderRadarRegion,
  type NowcastFrame,
  type RadarFrame,
} from "@/lib/cwb/radar";

const BUCKET = "https://cwaopendata.s3.ap-northeast-1.amazonaws.com";
const HISTORY = "history/Observation/";
/** 未來 1 小時雷達定量降雨預報：只有最新一筆，沒有歷史檔 */
const NOWCAST = "Forecast/F-B0046-001.xml";
const LIST_TIMEOUT_MS = 10_000;
const FRAME_TIMEOUT_MS = 20_000;
/** 同一 instance 內重用清單的時間；CWA 每 10 分鐘出一張 */
const LIST_REUSE_MS = 60 * 1000;
/** 同一 instance 內留著的圖張數（一輪回放＋換場時的上一輪） */
const FRAME_CACHE_SIZE = 14;

let listCache: { frames: RadarFrame[]; fetchedAt: number } | null = null;
/** 最新一筆降雨預報：畫好的圖跟著存，清單與圖用同一份，不會對不上 */
let nowcastCache: { frame: NowcastFrame; png: Buffer; fetchedAt: number } | null = null;
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

/** 依格點畫成調色盤 PNG；色階不到 60 色，不失真，一張通常幾十 KB */
function encode(rgba: Uint8Array): Promise<Buffer> {
  const { width, height } = RADAR_IMAGE_SIZE;
  return sharp(rgba, { raw: { width, height, channels: 4 } })
    .png({ palette: true, colors: 256, dither: 0, compressionLevel: 9 })
    .toBuffer();
}

/** 最新的未來 1 小時降雨預報；觀測時間由呼叫端判斷是否過期 */
export async function getRainNowcast(now = Date.now()): Promise<{ frame: NowcastFrame; png: Buffer }> {
  if (nowcastCache && now - nowcastCache.fetchedAt < LIST_REUSE_MS) return nowcastCache;
  const res = await fetch(`${BUCKET}/${NOWCAST}`, { cache: "no-store", signal: AbortSignal.timeout(FRAME_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`降雨預報 ${res.status}`);
  const { observedAt, values } = parseRainNowcast(await res.text());
  const id = nowcastFrameId(observedAt);
  if (!id) throw new Error(`降雨預報時間格式不對：${observedAt}`);
  const png = nowcastCache?.frame.id === id ? nowcastCache.png : await encode(renderNowcastRegion(values));
  nowcastCache = { frame: { id, issuedAt: observedAt }, png, fetchedAt: now };
  return nowcastCache;
}

async function renderFrame(id: string): Promise<Buffer> {
  const stamp = nowcastStamp(id);
  if (stamp) {
    // 預報只有最新一筆：要的不是最新那筆就當作找不到
    const { frame, png } = await getRainNowcast();
    if (frame.id !== id) throw new Error(`降雨預報 ${observedAtOfFrameId(stamp)} 已不是最新`);
    return png;
  }
  const res = await fetch(`${BUCKET}/${HISTORY}${id}compref_mosaic.xml`, {
    cache: "no-store",
    signal: AbortSignal.timeout(FRAME_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`雷達格點 ${id} ${res.status}`);
  const { values } = parseCompositeReflectivity(await res.text());
  return encode(renderRadarRegion(values));
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
