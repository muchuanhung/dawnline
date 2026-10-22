/**
 * 路線附近的雷達回波圖（CWA O-A0058-006 裁切）＋鄉鎮界
 * GET /api/radar?minLon=&minLat=&maxLon=&maxLat=
 *
 * 只供路線頁主視覺顯示，不影響判定。圖以 data URL 回傳（裁切後通常只有幾 KB），
 * 客戶端才能在同源 canvas 取色，算出目前位置的回波強度。
 * 觀測時間照實回傳，是否過期由客戶端依 isRadarStale 判斷。
 */

import { NextResponse } from "next/server";
import { RADAR_VIEW, radarCropFor, type Extent } from "@/lib/cwb/radar";
import { getRadarCrop } from "@/lib/cwb/radar.server";
import { townOutlinesInExtent } from "@/lib/maps/taiwan-towns-topojson";

export interface RadarResponse {
  /** 觀測時間（ISO，+08:00） */
  observedAt: string;
  /** 圖的範圍（WGS84） */
  extent: Extent;
  /** 裁切後的透明 PNG */
  image: string;
  /** 鄉鎮界，座標為 RADAR_VIEW 寬高 */
  towns: string;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const bbox = (["minLon", "minLat", "maxLon", "maxLat"] as const).map((k) =>
    parseFloat(searchParams.get(k) ?? "")
  ) as Extent;
  const crop = radarCropFor(bbox);
  if (!crop) {
    return NextResponse.json({ error: "路線不在雷達圖範圍內" }, { status: 400 });
  }

  try {
    const { observedAt, png } = await getRadarCrop(crop);
    const body: RadarResponse = {
      observedAt,
      extent: crop.extent,
      image: `data:image/png;base64,${png.toString("base64")}`,
      towns: townOutlinesInExtent(crop.extent, RADAR_VIEW.width, RADAR_VIEW.height),
    };
    // CWA 每 10 分鐘更新；CDN 快取 5 分鐘，最舊也只比最新晚一張
    return NextResponse.json(body, { headers: { "Cache-Control": "public, max-age=60, s-maxage=300" } });
  } catch (err) {
    console.error("[radar] 取得雷達圖失敗:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "雷達資料暫時取不到" }, { status: 502 });
  }
}
