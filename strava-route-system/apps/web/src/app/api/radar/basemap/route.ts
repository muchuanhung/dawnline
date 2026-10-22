/**
 * 雷達圖底圖：RADAR_EXTENT 範圍內的鄉鎮界，座標為 RADAR_VIEW（單一 SVG path）
 * GET /api/radar/basemap → { towns }
 * 內容固定，建置時產生。
 */

import { NextResponse } from "next/server";
import { RADAR_EXTENT, RADAR_VIEW } from "@/lib/cwb/radar";
import { townOutlinesInExtent } from "@/lib/maps/taiwan-towns-topojson";

export const dynamic = "force-static";

export function GET() {
  return NextResponse.json(
    { towns: townOutlinesInExtent(RADAR_EXTENT, RADAR_VIEW.width, RADAR_VIEW.height) },
    { headers: { "Cache-Control": "public, max-age=86400" } }
  );
}
