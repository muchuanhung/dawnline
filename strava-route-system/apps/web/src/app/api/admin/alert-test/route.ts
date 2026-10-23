/**
 * 告警管道測試：送一則測試訊息到 ALERT_WEBHOOK_URL，確認 production 的設定可用
 * production 需帶 header `x-alert-secret`，值須等於 env ALERT_TEST_SECRET；未設定時一律拒絕
 *
 * curl -X POST -H "x-alert-secret: <secret>" https://<host>/api/admin/alert-test
 */

import { NextResponse } from "next/server";
import { sendTestAlert } from "@/lib/observability/report";

function isAuthorized(request: Request): boolean {
  if (process.env.NODE_ENV !== "production") return true;
  const secret = process.env.ALERT_TEST_SECRET;
  if (!secret) return false;
  return request.headers.get("x-alert-secret") === secret;
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "未授權" }, { status: 401 });
  }
  const result = await sendTestAlert(new URL(request.url).searchParams.get("note") ?? undefined);
  // 沒設網址算設定錯誤（500），webhook 拒收或連不到算上游錯誤（502）
  const status = result.sent ? 200 : result.reason === "no-webhook" ? 500 : 502;
  return NextResponse.json(result, { status });
}
