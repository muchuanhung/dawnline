/**
 * 判定牌下方的行動建議（規則產生，不經 LLM）：危險時有較好的出發時段就建議改時段，沒有才說改期。
 * 不推薦替代路線：候選只有少數公開路線，推薦多半不是使用者會走的路（2026-10-21 michael 決定）。
 */

import type { RouteBriefing } from "@/lib/dashboard/briefing";
import { formatClock } from "@/lib/routes/trip";

/**
 * 危險路線的建議。時間與「各時段都危險」由下方建議出發時段列顯示，這裡不重複，
 * 只說要改時段還是改期。
 */
export function riskyAdvice(featured: RouteBriefing): string {
  const s = featured.departureSuggestion;
  // 建議時段只比較天氣：危險來自路況事件時，改時間不一定有用
  const riskyEvent = featured.hazards.some((h) => h.kind === "event" && h.level === "risky");
  if (s && !s.nowIsBest && s.level !== "risky" && !riskyEvent) return "建議改時段出發，或改期。";
  return "建議改期。";
}

/**
 * 路線卡「建議 X 出發」的時間；建議時段仍是危險天氣時不顯示，
 * 避免判定危險卻寫「建議現在出發」。
 */
export function departureLabelOf(s: RouteBriefing["departureSuggestion"], now: Date): string | null {
  if (!s || s.level === "risky") return null;
  return s.nowIsBest ? "現在" : formatClock(new Date(s.from), now);
}
