"use client";

import type { ReconVerdict } from "@/lib/routes/recon-geo";
import type { TripParams } from "@/lib/routes/trip";
import { summaryApplies } from "@/lib/dashboard/briefing-summary";
import { useBriefingSummary } from "@/hooks/useBriefingSummary";

/**
 * 判定短句：先顯示規則產生的 verdict.headline，AI 一句話摘要回來且依據同一份判定時再替換。
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
  const summary = useBriefingSummary(routeId, trip, "/api/routes/briefing", true);
  return <p className={className}>{summaryApplies(summary, verdict) ? summary.text : verdict.headline}</p>;
}
