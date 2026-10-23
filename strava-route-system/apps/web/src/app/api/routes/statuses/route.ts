/**
 * 路線清單卡片的判讀標籤：所有公開路線的判定等級。
 * 與單一路線判讀（/api/routes/briefing）同一套流程，同一條路線兩邊等級一致；
 * 外部資料來自 Firestore 的判讀輸入，一次算完所有路線不會多打 CWB／TDX。
 */

import { NextResponse } from "next/server";
import { getRouteStatuses } from "@/lib/dashboard/get-briefing.server";

export async function GET() {
  try {
    return NextResponse.json(await getRouteStatuses(), { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("路線清單判讀 API 錯誤:", err);
    return NextResponse.json({ error: "無法判讀路線" }, { status: 500 });
  }
}
