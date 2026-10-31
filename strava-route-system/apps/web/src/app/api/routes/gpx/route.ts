/**
 * 公開路線列表（來源：FastAPI 後端，見 load-routes.server.ts）
 */

import { NextResponse } from "next/server";
import { loadRoutes } from "@/lib/routes/load-routes.server";

export async function GET() {
  try {
    return NextResponse.json(await loadRoutes());
  } catch (err) {
    console.error("GPX routes API error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "無法載入路線" },
      { status: 500 }
    );
  }
}
