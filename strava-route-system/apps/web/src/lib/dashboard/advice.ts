/**
 * 判定牌下方的行動建議（規則產生，不經 LLM）：危險時依現有資料給具體做法，
 * 有替代路線就點名、有較好的出發時段就給時間，都沒有才說改期。
 */

import type { RouteBriefing } from "@/lib/dashboard/briefing";
import { SUGGEST_HORIZON_H } from "@/lib/dashboard/briefing";
import { formatClock } from "@/lib/routes/trip";

/** 危險路線的建議；alternative 為 pickAlternative 的結果 */
export function riskyAdvice(featured: RouteBriefing, alternative: RouteBriefing | null, now: Date): string {
  if (alternative) return `建議改走「${alternative.name}」，或改期。`;
  const s = featured.departureSuggestion;
  if (s?.level === "risky") return `未來 ${SUGGEST_HORIZON_H} 小時都有危險天氣，建議改期。`;
  // 建議時段只比較天氣：危險來自路況事件時，改時間不一定有用
  const riskyEvent = featured.hazards.some((h) => h.kind === "event" && h.level === "risky");
  if (s && !s.nowIsBest && !riskyEvent) return `建議改 ${formatClock(new Date(s.from), now)} 出發，或改期。`;
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
