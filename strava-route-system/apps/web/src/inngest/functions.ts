import { inngest } from "@/inngest/client";
import { fetchAllCCTV, TDX_SYNC_CITIES } from "@/lib/tdx/client";
import { persistCCTVFirestore } from "@/lib/background/tdx-cctv.firestore";
import { refreshBriefingInputs } from "@/lib/dashboard/get-briefing.server";
import { reportError } from "@/lib/observability/report";

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
  {
    id: "tdx-cctv-sync",
    name: "TDX CCTV 每日同步",
    // 重試用盡仍失敗：鏡頭清單會停在上一次的資料，畫面不會報錯，所以一定要主動送出去
    onFailure: ({ error }) => reportError("inngest", "tdx-cctv-sync-failed", error),
  },
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
 * 判讀輸入更新
 *
 * ## 觸發
 * cron: "*\/10 * * * *" → 每 10 分鐘（判讀輸入超過 15 分鐘就不採用，留 5 分鐘緩衝）
 *
 * ## 流程
 * step.run("refresh-inputs")：重抓所有公開路線用到的 CWB 天氣、雨量站、TDX 事件，寫入 Firestore briefing-inputs；
 * 使用者請求只讀這份資料，不必再打 CWB／TDX（TDX 限流很嚴，只有這裡在打）
 */
export const refreshInputs = inngest.createFunction(
  {
    id: "briefing-inputs-refresh",
    name: "判讀輸入更新",
    onFailure: ({ error }) => reportError("inngest", "briefing-inputs-refresh-failed", error),
  },
  { cron: "*/10 * * * *" },
  async ({ step }) => step.run("refresh-inputs", () => refreshBriefingInputs())
);

export const allInngestFunctions = [syncTDXCCTV, refreshInputs];
