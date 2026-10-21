/**
 * 私人路線的 AI 一句話摘要：與 /api/routes/briefing/summary 相同，差別只在路線來源（後端 S3）。
 * 每次都先經後端確認是自己的路線，再用快取的判讀與句子（getPrivateRouteSummary）。
 */

import { NextResponse } from "next/server";
import { getPrivateRouteSummary } from "@/lib/ai/summary.server";
import { loadPrivateRoute, PrivateRouteError } from "@/lib/routes/private-route.server";
import { cachedParsedGpx } from "@/lib/routes/private-gpx-cache.server";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const routeId = params.get("route");
  if (!routeId) return NextResponse.json({ error: "缺少 route 參數" }, { status: 400 });
  try {
    const route = await loadPrivateRoute(routeId, request.headers.get("cookie") ?? "", cachedParsedGpx);
    return NextResponse.json(
      { summary: await getPrivateRouteSummary(route, params.get("depart"), params.get("activity")) },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (err) {
    if (err instanceof PrivateRouteError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("私人路線摘要 API 錯誤:", err);
    return NextResponse.json({ summary: null }, { status: 500 });
  }
}
