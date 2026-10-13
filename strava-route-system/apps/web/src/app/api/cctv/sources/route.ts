/**
 * CCTV 鏡頭網址來源統計（評估探測是否值得做，唯讀）
 * GET /api/cctv/sources            來源分佈
 * GET /api/cctv/sources?probe=1    另外對每個網域的範例鏡頭實際探測一次，看是影像還是播放頁
 */

import { NextResponse } from "next/server";
import { getAllCCTVSources } from "@/lib/background/tdx-cctv.firestore";
import { summarizeCctvSources } from "@/lib/cctv/source-stats";
import { probeCctvUrl } from "@/lib/cctv/probe.server";

// 每個網域探測一台，最多約 30 個網域，並行執行，單台 5 秒逾時
export const maxDuration = 30;

export async function GET(request: Request) {
  try {
    const items = await getAllCCTVSources();
    const stats = summarizeCctvSources(items);
    if (new URL(request.url).searchParams.get("probe") !== "1") return NextResponse.json(stats);

    // 只探測網域範例，不寫入 cctv_status；結果僅供評估
    const byHost = await Promise.all(
      stats.byHost.map(async (h) => {
        const attempt = await probeCctvUrl(h.sampleUrl);
        return { ...h, sampleProbe: { outcome: attempt.outcome, firstFrameMs: attempt.firstFrameMs } };
      })
    );
    return NextResponse.json({ ...stats, byHost });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
