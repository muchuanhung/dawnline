/**
 * CCTV 鏡頭網址來源統計（評估探測是否值得做，唯讀）
 * GET /api/cctv/sources
 */

import { NextResponse } from "next/server";
import { getAllCCTVSources } from "@/lib/background/tdx-cctv.firestore";
import { summarizeCctvSources } from "@/lib/cctv/source-stats";

export async function GET() {
  try {
    const items = await getAllCCTVSources();
    return NextResponse.json(summarizeCctvSources(items));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
