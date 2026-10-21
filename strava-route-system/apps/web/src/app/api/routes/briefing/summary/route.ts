/**
 * 單一路線的 AI 一句話摘要：用與 /api/routes/briefing 相同的判讀流程算出判定，再交給 Claude 措辭。
 * 摘要失敗或未設定時回 { summary: null }，前端維持顯示 verdict.headline。
 * 途中模式（from）不提供摘要：里程每次變動都會是新的事實，改用規則句即可。
 */

import { NextResponse } from "next/server";
import { getRouteBriefing } from "@/lib/dashboard/get-briefing.server";
import { summarizeBriefing } from "@/lib/ai/summary.server";
import { parseActivity, parseDeparture } from "@/lib/routes/trip";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const routeId = params.get("route");
  if (!routeId) return NextResponse.json({ error: "缺少 route 參數" }, { status: 400 });
  try {
    const briefing = await getRouteBriefing(routeId, {
      departure: parseDeparture(params.get("depart"), new Date()) ?? undefined,
      activity: parseActivity(params.get("activity")) ?? undefined,
    });
    if (!briefing) return NextResponse.json({ error: "找不到路線" }, { status: 404 });
    return NextResponse.json({ summary: await summarizeBriefing(briefing) }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("路線摘要 API 錯誤:", err);
    return NextResponse.json({ summary: null }, { status: 500 });
  }
}
