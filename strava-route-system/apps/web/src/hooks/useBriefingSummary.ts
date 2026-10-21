"use client";

import { useEffect, useState } from "react";
import type { BriefingSummary } from "@/lib/dashboard/briefing-summary";
import { withTrip, type TripParams } from "@/lib/routes/trip";

/**
 * AI 一句話摘要：與判讀同時另外抓，抓到前與失敗時都是 null，畫面維持 verdict.headline。
 * enabled：非離線快照、非途中模式時抓（快照或途中模式一律用規則句）。
 * endpoint：判讀 API；摘要 API 是它底下的 /summary（公開、私人路線各一支）。
 */
export function useBriefingSummary(
  routeId: string | null | undefined,
  trip: TripParams,
  endpoint: string,
  enabled: boolean
): BriefingSummary | null {
  const { depart, activity } = trip;
  const [summary, setSummary] = useState<BriefingSummary | null>(null);

  useEffect(() => {
    setSummary(null);
    if (!routeId || !enabled) return;
    let cancelled = false;
    fetch(withTrip(`${endpoint}/summary?route=${encodeURIComponent(routeId)}`, { depart, activity }))
      .then((res) => (res.ok ? (res.json() as Promise<{ summary: BriefingSummary | null }>) : { summary: null }))
      .then(({ summary }) => {
        if (!cancelled) setSummary(summary);
      })
      // 摘要只是加分項：網路失敗不顯示錯誤
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [routeId, depart, activity, endpoint, enabled]);

  return summary;
}
