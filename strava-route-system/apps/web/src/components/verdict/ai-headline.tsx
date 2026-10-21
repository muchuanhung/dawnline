"use client";

import type { ReconVerdict } from "@/lib/routes/recon-geo";
import type { TripParams } from "@/lib/routes/trip";
import { summaryApplies } from "@/lib/dashboard/briefing-summary";
import { useBriefingSummary } from "@/hooks/useBriefingSummary";

/**
 * 判定短句：等 AI 一句話摘要（最多 SUMMARY_WAIT_MS），依據同一份判定才用 AI 句子，否則用規則產生的 verdict.headline；
 * 顯示後不再換句。
 * 伺服器元件（Dashboard 判定牌）用；路線頁由 useRouteRecon 抓摘要。
 */
export function AiHeadline({
  routeId,
  trip,
  verdict,
  className,
}: {
  routeId: string;
  trip: TripParams;
  verdict: Pick<ReconVerdict, "level" | "headline">;
  className?: string;
}) {
  // 判定牌是伺服器算好的，掛載時判讀已就緒：最多等 SUMMARY_WAIT_MS，期間句子位置顯示骨架
  const { summary, pending } = useBriefingSummary(routeId, trip, "/api/routes/briefing", true);
  if (pending) {
    return (
      <p className={className}>
        <span role="status" className="block h-[1lh] w-3/4 max-w-xs animate-pulse rounded bg-current opacity-15">
          <span className="sr-only">判定說明載入中</span>
        </span>
      </p>
    );
  }
  return <p className={className}>{summaryApplies(summary, verdict) ? summary.text : verdict.headline}</p>;
}
