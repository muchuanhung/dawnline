/**
 * 單一路線今日判讀：判定、示警、合併天氣後的路段都在伺服器算，前端只負責顯示。
 * 與 Dashboard 共用 get-briefing.server 的流程，確保同一條路線兩頁判定一致。
 */

import { NextResponse } from "next/server";
import { getRouteBriefing } from "@/lib/dashboard/get-briefing.server";
import { parseActivity, parseDeparture, parseFromKm } from "@/lib/routes/trip";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const routeId = params.get("route");
  if (!routeId) return NextResponse.json({ error: "缺少 route 參數" }, { status: 400 });
  try {
    const briefing = await getRouteBriefing(routeId, {
      departure: parseDeparture(params.get("depart"), new Date()) ?? undefined,
      activity: parseActivity(params.get("activity")) ?? undefined,
      fromKm: parseFromKm(params.get("from")) ?? undefined,
      // 自訂平地均速；briefRoute 依最終運動類型驗證範圍
      speedKmh: params.get("speed") ? Number(params.get("speed")) : undefined,
    });
    if (!briefing) return NextResponse.json({ error: "找不到路線" }, { status: 404 });
    return NextResponse.json(briefing, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("路線判讀 API 錯誤:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "無法判讀路線" }, { status: 500 });
  }
}
