/**
 * 單張雷達回波圖（透明 PNG，範圍見 RADAR_EXTENT）
 * GET /api/radar/frame?id=YYYYMMDDHHmm（觀測）或 nYYYYMMDDHHmm（未來 1 小時降雨預報）
 *
 * 同一個時間戳的圖不會再變，瀏覽器與 CDN 都長期快取。
 * 同源回傳，客戶端才能在 canvas 取色，算出目前位置的回波強度。
 */

import { isRadarFrameId, nowcastStamp } from "@/lib/cwb/radar";
import { getRadarFramePng } from "@/lib/cwb/radar.server";

/** 一筆格點約 9 MB，下載加解析留足時間 */
export const maxDuration = 30;

export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!isRadarFrameId(id) && !nowcastStamp(id)) {
    return Response.json({ error: "時間格式不對" }, { status: 400 });
  }
  try {
    const png = await getRadarFramePng(id);
    return new Response(new Uint8Array(png), {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=86400, s-maxage=31536000, immutable",
      },
    });
  } catch (err) {
    console.error("[radar] 取得雷達圖失敗:", id, err instanceof Error ? err.message : err);
    return Response.json({ error: "雷達圖暫時取不到" }, { status: 502 });
  }
}
