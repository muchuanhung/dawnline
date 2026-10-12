/**
 * CCTV 連線狀態（探測＋快取）
 * GET /api/cctv/status?ids=a,b,c
 * 回傳 { statuses: { [id]: "online" | "degraded" | "offline" | "unknown" } }
 *
 * - 只收鏡頭 id，網址由伺服器從 Firestore／靜態清單查，不接受前端傳網址
 * - 5 分鐘內探測過的鏡頭直接用 cctv_status 快取，其餘當場探測
 * - 查不到網址或探測出錯的鏡頭一律 unknown
 */

import { NextResponse } from "next/server";
import { getCCTVVideoUrls } from "@/lib/background/tdx-cctv.firestore";
import { getProbeHistories, saveProbeHistories } from "@/lib/background/cctv-status.firestore";
import { getStaticCCTVVideoUrl } from "@/lib/cctv/static-supplement";
import { probeCctvUrl } from "@/lib/cctv/probe.server";
import {
  appendProbeAttempt,
  classifyProbeHistory,
  isProbeFresh,
  type CctvProbeStatus,
  type ProbeAttempt,
} from "@/lib/cctv/probe-status";

// 最壞情況：MAX_IDS 台鏡頭、每批 PROBE_CONCURRENCY 台、每台 5 秒逾時
export const maxDuration = 30;

/** near-route 最多回 30 台 TDX＋少量靜態鏡頭 */
const MAX_IDS = 40;
const PROBE_CONCURRENCY = 8;
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const ids = [
    ...new Set(
      (searchParams.get("ids") ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    ),
  ];

  if (ids.length === 0) {
    return NextResponse.json({ error: "缺少 ids 參數" }, { status: 400 });
  }
  if (ids.length > MAX_IDS || ids.some((id) => !ID_PATTERN.test(id))) {
    return NextResponse.json({ error: `ids 格式錯誤或超過 ${MAX_IDS} 個` }, { status: 400 });
  }

  try {
    const now = Date.now();
    const histories = await getProbeHistories(ids);
    const staleIds = ids.filter((id) => !isProbeFresh(histories.get(id) ?? [], now));

    // 需要探測的鏡頭才查網址
    const tdxIds = staleIds.filter((id) => !id.startsWith("static-"));
    const tdxUrls = await getCCTVVideoUrls(tdxIds);
    const urlOf = (id: string) => (id.startsWith("static-") ? getStaticCCTVVideoUrl(id) : tdxUrls.get(id));

    // 清單裡找不到的 id 不探測、不寫入，避免任意 id 灌爆 cctv_status
    const probeIds = staleIds.filter((id) => urlOf(id) !== undefined);
    const attempts = await mapWithConcurrency(probeIds, PROBE_CONCURRENCY, (id) => probeCctvUrl(urlOf(id)));

    const updated = new Map<string, ProbeAttempt[]>();
    probeIds.forEach((id, i) => {
      const next = appendProbeAttempt(histories.get(id) ?? [], attempts[i]!);
      histories.set(id, next);
      updated.set(id, next);
    });
    await saveProbeHistories(updated);

    const statuses: Record<string, CctvProbeStatus> = {};
    for (const id of ids) {
      statuses[id] = classifyProbeHistory(histories.get(id) ?? [], Date.now());
    }
    return NextResponse.json({ statuses });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/** 同時最多跑 limit 個，結果順序與輸入相同 */
async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]!);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
