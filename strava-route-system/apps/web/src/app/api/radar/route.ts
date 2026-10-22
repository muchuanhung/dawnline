/**
 * 可回放的雷達回波圖清單（CWA 合成回波歷史檔，最新一張往前 6 小時，每小時一張）
 * GET /api/radar → RadarManifest
 *
 * 只供路線頁顯示，不影響判定。觀測時間照實回傳，是否過期由客戶端依 isRadarStale 判斷。
 * 圖本身由 /api/radar/frame?id= 提供，鄉鎮界由 /api/radar/basemap 提供。
 */

import { NextResponse } from "next/server";
import type { RadarManifest } from "@/lib/cwb/radar";
import { listRadarFrames } from "@/lib/cwb/radar.server";

export async function GET() {
  try {
    const body: RadarManifest = { frames: await listRadarFrames() };
    if (body.frames.length === 0) throw new Error("沒有雷達圖");
    // CWA 每 10 分鐘更新；CDN 快取 1 分鐘
    return NextResponse.json(body, { headers: { "Cache-Control": "public, max-age=60, s-maxage=60" } });
  } catch (err) {
    console.error("[radar] 取得雷達清單失敗:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "雷達資料暫時取不到" }, { status: 502 });
  }
}
