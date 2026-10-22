/**
 * CWA 雷達整合回波（O-A0058-006）：伺服器端抓圖與裁切
 * 資料放在 CWA 公開 S3，不需要金鑰。原圖約 350 KB，同一個觀測時間在同一個 instance 只抓一次。
 * 只供顯示，不進判讀（briefing 不會呼叫這裡）。
 */

import sharp from "sharp";
import { RADAR_IMAGE, type RadarCrop } from "@/lib/cwb/radar";

const BASE = "https://cwaopendata.s3.ap-northeast-1.amazonaws.com/Observation/O-A0058-006";
const REQUEST_TIMEOUT_MS = 10_000;
/** 同一 instance 內重用原圖的時間；CWA 每 10 分鐘出一張 */
const REUSE_MS = 2 * 60 * 1000;

type RadarSource = { observedAt: string; png: Buffer; fetchedAt: number };
let cached: RadarSource | null = null;

type Meta = {
  cwaopendata?: {
    dataset?: {
      DateTime?: string;
      datasetInfo?: { parameterSet?: { LongitudeRange?: string; LatitudeRange?: string; ImageDimension?: string } };
    };
  };
};

/** 資料集說明的範圍與尺寸必須與 RADAR_IMAGE 一致，否則裁切會錯位，寧可不顯示 */
function assertLayout(meta: Meta): string {
  const ds = meta.cwaopendata?.dataset;
  const p = ds?.datasetInfo?.parameterSet;
  const range = (s?: string) => (s ?? "").split("-").map(Number);
  const [lon0, lon1] = range(p?.LongitudeRange);
  const [lat0, lat1] = range(p?.LatitudeRange);
  const ok =
    lon0 === RADAR_IMAGE.minLon &&
    lon1 === RADAR_IMAGE.maxLon &&
    lat0 === RADAR_IMAGE.minLat &&
    lat1 === RADAR_IMAGE.maxLat &&
    p?.ImageDimension === `${RADAR_IMAGE.size}x${RADAR_IMAGE.size}`;
  if (!ok || !ds?.DateTime) throw new Error("雷達圖層格式與預期不符");
  return ds.DateTime;
}

async function loadSource(): Promise<RadarSource> {
  if (cached && Date.now() - cached.fetchedAt < REUSE_MS) return cached;
  const metaRes = await fetch(`${BASE}.json`, { cache: "no-store", signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!metaRes.ok) throw new Error(`雷達說明 ${metaRes.status}`);
  const observedAt = assertLayout((await metaRes.json()) as Meta);
  // 觀測時間沒變就沿用舊圖，只更新檢查時間
  if (cached?.observedAt === observedAt) {
    cached = { ...cached, fetchedAt: Date.now() };
    return cached;
  }
  const pngRes = await fetch(`${BASE}.png`, { cache: "no-store", signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!pngRes.ok) throw new Error(`雷達圖 ${pngRes.status}`);
  cached = { observedAt, png: Buffer.from(await pngRes.arrayBuffer()), fetchedAt: Date.now() };
  return cached;
}

/** 裁出路線附近的雷達圖（透明 PNG）；觀測時間由呼叫端判斷是否過期 */
export async function getRadarCrop(crop: RadarCrop): Promise<{ observedAt: string; png: Buffer }> {
  const source = await loadSource();
  const png = await sharp(source.png).extract(crop.pixel).png().toBuffer();
  return { observedAt: source.observedAt, png };
}
