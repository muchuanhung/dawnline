/**
 * 單一路線的 AI 一句話摘要：用與判讀 API 相同的流程只判讀這一條路線（headline 與判定牌一致），再交給 Claude 措辭。
 * 結果連同判讀快取 10 分鐘（getPublicRouteSummary），同一條路線再打開時不必重新判讀、也不必再等 Claude。
 * 前端與判讀同時發出；依據的判定不同時由 summaryApplies 擋下。
 * 摘要失敗或未設定時回 { summary: null }，前端維持顯示 verdict.headline。
 * 途中模式（from）不提供摘要：里程每次變動都會是新的事實，改用規則句即可。
 */

import { NextResponse } from "next/server";
import { getPublicRouteSummary } from "@/lib/ai/summary.server";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const routeId = params.get("route");
  if (!routeId) return NextResponse.json({ error: "缺少 route 參數" }, { status: 400 });
  try {
    const { found, summary } = await getPublicRouteSummary(routeId, params.get("depart"), params.get("activity"));
    if (!found) return NextResponse.json({ error: "找不到路線" }, { status: 404 });
    return NextResponse.json({ summary }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("路線摘要 API 錯誤:", err);
    return NextResponse.json({ summary: null }, { status: 500 });
  }
}
