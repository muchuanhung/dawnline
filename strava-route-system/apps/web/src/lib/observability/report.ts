/**
 * 錯誤回報與上游失敗率告警
 *
 * Vercel 的 console log 不聚合也不會通知：CWB 或 TDX 整批掛掉時，畫面只會安靜地少資料，
 * 沒有人會發現。這裡做兩件事：
 * 1. 把錯誤輸出成單行 JSON，log 平台（Vercel Log Drain、Logtail、Datadog）可以直接查詢與設規則。
 * 2. 設了 ALERT_WEBHOOK_URL 就推一則訊息（Slack／Discord 的 incoming webhook 都吃 { text }）。
 *
 * 告警去重只在單一 instance 的記憶體裡，serverless 重啟或擴容後會重新計算；
 * 目的是避免同一個 instance 連續洗版，不是精確的全域節流。
 */

export type ErrorScope = "cwb" | "tdx" | "firestore" | "api" | "inngest" | "ai";

/** 同一種失敗在同一個 instance 內的告警間隔 */
const ALERT_COOLDOWN_MS = 5 * 60_000;

const lastAlertAt = new Map<string, number>();

function describe(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return String(err);
}

/**
 * 記錄一次失敗，並視情況送出告警。
 * @param scope 上游或子系統
 * @param event 事件代號（同一個 event 共用一個告警節流 key）
 */
export function reportError(
  scope: ErrorScope,
  event: string,
  err: unknown,
  meta: Record<string, unknown> = {}
): void {
  const message = describe(err);
  console.error(JSON.stringify({ level: "error", scope, event, message, ...meta }));
  void sendAlert(`[曉行] ${scope}／${event}：${message}`, `${scope}:${event}`, meta);
}

/**
 * 上游失敗率告警：成功筆數太低時送一則訊息。
 * 呼叫端已經有「幾個成功／幾個總數」時用這支，不要自己在記憶體裡累計跨請求的比率
 * （serverless 每個 instance 看到的樣本不同，累計出來的數字沒有意義）。
 */
export function reportFailureRate(
  scope: ErrorScope,
  event: string,
  ok: number,
  total: number,
  { minSample = 2, threshold = 0.5, ...meta }: { minSample?: number; threshold?: number; [k: string]: unknown } = {}
): void {
  if (total < minSample) return;
  const failureRate = (total - ok) / total;
  if (failureRate < threshold) return;
  const percent = Math.round(failureRate * 100);
  console.error(JSON.stringify({ level: "error", scope, event, ok, total, failureRate, ...meta }));
  void sendAlert(`[曉行] ${scope}／${event}：${total} 筆中 ${total - ok} 筆失敗（${percent}%）`, `${scope}:${event}`, meta);
}

async function sendAlert(text: string, key: string, meta: Record<string, unknown>): Promise<void> {
  const url = process.env.ALERT_WEBHOOK_URL;
  if (!url) return;
  const now = Date.now();
  if (now - (lastAlertAt.get(key) ?? 0) < ALERT_COOLDOWN_MS) return;
  lastAlertAt.set(key, now);
  try {
    await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: Object.keys(meta).length ? `${text}\n${JSON.stringify(meta)}` : text }),
    });
  } catch (e) {
    // 告警管道自己失敗時只留 log，不能再往上丟例外影響判讀
    console.error(JSON.stringify({ level: "error", scope: "api", event: "alert-webhook-failed", message: describe(e) }));
  }
}

export type TestAlertResult =
  | { sent: true; status: number }
  | { sent: false; reason: "no-webhook" | "webhook-rejected" | "webhook-unreachable"; status?: number; message?: string };

/**
 * 手動驗證告警管道用：不走節流，直接送一則測試訊息，並把 webhook 的回應交回呼叫端
 * （一般告警不檢查回應碼，網址打錯時只能靠這支看出來）。
 */
export async function sendTestAlert(note?: string): Promise<TestAlertResult> {
  const url = process.env.ALERT_WEBHOOK_URL;
  if (!url) return { sent: false, reason: "no-webhook" };
  const env = process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "unknown";
  const text = `[曉行] 測試告警（${env}）${note ? `：${note}` : ""}`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) return { sent: false, reason: "webhook-rejected", status: res.status };
    return { sent: true, status: res.status };
  } catch (e) {
    return { sent: false, reason: "webhook-unreachable", message: describe(e) };
  }
}
