import { inngest } from "@/inngest/client";
import { fetchAllCCTV, TDX_SYNC_CITIES } from "@/lib/tdx/client";
import { persistCCTVFirestore } from "@/lib/background/tdx-cctv.firestore";
import { loadRoutes } from "@/lib/routes/load-routes.server";
import { getPublicRouteSummary } from "@/lib/ai/summary.server";

/**
 * TDX CCTV 每日同步
 *
 * ## 觸發
 * cron: "0 4 * * *" → 每天 04:00 UTC（台灣 12:00）
 *
 * ## 流程
 * 1. step.run("fetch-tdx-cctv")：呼叫 TDX API 取得 TDX_CITY_CODES 全部縣市 CCTV，節流 500ms/縣市
 * 2. step.run("persist-cctv")：寫入 Firestore cctv collection，含 geohash
 *
 */
export const syncTDXCCTV = inngest.createFunction(
  { id: "tdx-cctv-sync", name: "TDX CCTV 每日同步" },
  { cron: "0 4 * * *" },
  async ({ step }) => {
    const items = await step.run("fetch-tdx-cctv", () =>
      fetchAllCCTV(TDX_SYNC_CITIES)
    );
    const { written, skipped } = await step.run("persist-cctv", () =>
      persistCCTVFirestore(items)
    );
    return { total: items.length, written, skipped };
  }
);

/**
 * 公開路線 AI 摘要預熱
 *
 * ## 觸發
 * cron: "*\/10 * * * *" → 每 10 分鐘（與 CWB、TDX、路線清單的 10 分鐘快取對齊）
 *
 * ## 流程
 * 每條公開路線一個 step：以「現在出發、預設運動類型」（網址沒帶 depart／activity）呼叫 getPublicRouteSummary，
 * 順便讓路線清單、各縣市 TDX 事件、CWB 天氣的快取保持新鮮，並把 AI 句子放進快取，使用者打開時直接命中。
 * Claude 只在判讀事實改變時才會被呼叫（句子以事實為 key 快取一天），其餘只是重算判讀（天氣、路況本身也有快取）。
 */
export const warmRouteSummaries = inngest.createFunction(
  { id: "route-summary-warm", name: "公開路線 AI 摘要預熱" },
  { cron: "*/10 * * * *" },
  async ({ step }) => {
    const ids = await step.run("list-routes", async () => (await loadRoutes()).map((r) => r.id));
    let phrased = 0;
    for (const id of ids) {
      const ok = await step.run(`warm-${id}`, async () => (await getPublicRouteSummary(id, null, null)).summary != null);
      if (ok) phrased += 1;
    }
    return { routes: ids.length, phrased };
  }
);

export const allInngestFunctions = [syncTDXCCTV, warmRouteSummaries];
