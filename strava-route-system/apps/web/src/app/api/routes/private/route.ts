/**
 * 單一私人路線：伺服器端向後端讀 GPX 並解析成 Route，格式與 /api/routes/gpx 的每一筆相同。
 * 帶使用者的 cookie 呼叫後端，只有路線擁有者讀得到。
 */

import { NextResponse } from "next/server";
import { loadPrivateRoute, PrivateRouteError } from "@/lib/routes/private-route.server";

export async function GET(request: Request) {
  const routeId = new URL(request.url).searchParams.get("route");
  if (!routeId) return NextResponse.json({ error: "缺少 route 參數" }, { status: 400 });
  try {
    const route = await loadPrivateRoute(routeId, request.headers.get("cookie") ?? "");
    // 私人資料：不讓瀏覽器或 CDN 快取
    return NextResponse.json(route, { headers: { "Cache-Control": "private, no-store" } });
  } catch (err) {
    if (err instanceof PrivateRouteError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("私人路線 API 錯誤:", err);
    return NextResponse.json({ error: "無法載入路線" }, { status: 500 });
  }
}
