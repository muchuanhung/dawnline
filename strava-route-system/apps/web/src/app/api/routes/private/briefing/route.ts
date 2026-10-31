/**
 * 私人路線今日判讀：與 /api/routes/briefing 同一套判讀流程與參數，
 * 差別只在路線來源（後端的私人路線，而不是公開路線）。
 */

import { NextResponse } from "next/server";
import { briefLoadedRoute } from "@/lib/dashboard/get-briefing.server";
import { loadPrivateRoute, PrivateRouteError } from "@/lib/routes/private-route.server";
import { cachedParsedGpx } from "@/lib/routes/private-gpx-cache.server";
import { parseActivity, parseDeparture, parseFromKm } from "@/lib/routes/trip";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const routeId = params.get("route");
  if (!routeId) return NextResponse.json({ error: "缺少 route 參數" }, { status: 400 });
  try {
    const route = await loadPrivateRoute(routeId, request.headers.get("cookie") ?? "", cachedParsedGpx);
    const briefing = await briefLoadedRoute(route, {
      departure: parseDeparture(params.get("depart"), new Date()) ?? undefined,
      activity: parseActivity(params.get("activity")) ?? undefined,
      fromKm: parseFromKm(params.get("from")) ?? undefined,
      // 自訂平地均速；briefRoute 依最終運動類型驗證範圍
      speedKmh: params.get("speed") ? Number(params.get("speed")) : undefined,
    });
    if (!briefing) return NextResponse.json({ error: "找不到路線" }, { status: 404 });
    return NextResponse.json(briefing, { headers: { "Cache-Control": "private, no-store" } });
  } catch (err) {
    if (err instanceof PrivateRouteError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("私人路線判讀 API 錯誤:", err);
    return NextResponse.json({ error: "無法判讀路線" }, { status: 500 });
  }
}
