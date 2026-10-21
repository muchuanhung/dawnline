import { inngest } from "@/inngest/client";
import { fetchAllCCTV, TDX_SYNC_CITIES } from "@/lib/tdx/client";
import { persistCCTVFirestore } from "@/lib/background/tdx-cctv.firestore";
import { loadRoutes } from "@/lib/routes/load-routes.server";
import { getPublicRouteSummary } from "@/lib/ai/summary.server";
import { getRouteBriefing } from "@/lib/dashboard/get-briefing.server";

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
 * cron: "*\/10 * * * *" → 每 10 分鐘（與 getPublicRouteSummary 的 10 分鐘快取對齊）
 *
 * ## 流程
 * 每條公開路線一個 step：以「現在出發、預設運動類型」（網址沒帶 depart／activity）呼叫 getPublicRouteSummary，
 * 先預熱判讀快取（getRouteBriefing，Dashboard 與判讀 API 共用），再預熱判讀＋AI 句子的摘要快取，
 * 使用者第一次打開 Dashboard 或路線頁就直接命中。
 * 判讀要單獨預熱：摘要快取命中時不會再讀判讀快取，判讀快取就不會被刷新。
 * Claude 只在判讀事實改變時才會被呼叫（句子以事實為 key 快取一天），其餘只是重算判讀（天氣、路況本身也有快取）。
 */
export const warmRouteSummaries = inngest.createFunction(
  { id: "route-summary-warm", name: "公開路線 AI 摘要預熱" },
  { cron: "*/10 * * * *" },
  async ({ step }) => {
    const ids = await step.run("list-routes", async () => (await loadRoutes()).map((r) => r.id));
    let phrased = 0;
    for (const id of ids) {
      const ok = await step.run(`warm-${id}`, async () => {
        await getRouteBriefing(id);
        return (await getPublicRouteSummary(id, null, null)).summary != null;
      });
      if (ok) phrased += 1;
    }
    return { routes: ids.length, phrased };
  }
);

export const allInngestFunctions = [syncTDXCCTV, warmRouteSummaries];
