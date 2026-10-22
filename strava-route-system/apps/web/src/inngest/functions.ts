import { inngest } from "@/inngest/client";
import { fetchAllCCTV, TDX_SYNC_CITIES } from "@/lib/tdx/client";
import { persistCCTVFirestore } from "@/lib/background/tdx-cctv.firestore";
import { loadRoutes } from "@/lib/routes/load-routes.server";
import { getPublicRouteSummary } from "@/lib/ai/summary.server";
import { refreshBriefingInputs } from "@/lib/dashboard/get-briefing.server";

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
 * 判讀輸入更新＋公開路線 AI 摘要預熱
 *
 * ## 觸發
 * cron: "*\/10 * * * *" → 每 10 分鐘（判讀輸入超過 15 分鐘就不採用，留 5 分鐘緩衝）
 *
 * ## 流程
 * 1. step.run("refresh-inputs")：重抓所有公開路線用到的 CWB 天氣、雨量站、TDX 事件，寫入 Firestore briefing-inputs；
 *    使用者請求只讀這份資料，不必再打 CWB／TDX（TDX 限流很嚴，只有這裡在打）
 * 2. 每條公開路線一個 step：以「現在出發、預設運動類型」呼叫 getPublicRouteSummary，把 AI 句子放進快取。
 *    Claude 只在判讀事實改變時才會被呼叫（句子以事實為 key 快取一天）
 */
export const warmRouteSummaries = inngest.createFunction(
  { id: "route-summary-warm", name: "判讀輸入更新與 AI 摘要預熱" },
  { cron: "*/10 * * * *" },
  async ({ step }) => {
    const inputs = await step.run("refresh-inputs", () => refreshBriefingInputs());
    const ids = await step.run("list-routes", async () => (await loadRoutes()).map((r) => r.id));
    let phrased = 0;
    for (const id of ids) {
      const ok = await step.run(`warm-${id}`, async () => (await getPublicRouteSummary(id, null, null)).summary != null);
      if (ok) phrased += 1;
    }
    return { ...inputs, routes: ids.length, phrased };
  }
);

export const allInngestFunctions = [syncTDXCCTV, warmRouteSummaries];
