/**
 * 判定牌下方的行動建議（規則產生，不經 LLM）：危險時有較好的出發時段就建議改時段，沒有才說改期。
 * 不推薦替代路線：候選只有少數公開路線，推薦多半不是使用者會走的路（2026-10-21 michael 決定）。
 */

import type { DepartureSuggestion, RouteBriefing } from "@/lib/dashboard/briefing";
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

const HALF_HOUR_MS = 30 * 60_000;

/**
 * 建議出發區間對齊整點／半點顯示（試算從「現在」起每 30 分鐘一格，原始時間會是 06:13 這類零碎分鐘）。
 * 起點往後取、終點往前取，區間只縮不擴，不會顯示沒試算過的時間；縮到沒有區間時沿用原本的時間。
 * 現在就是最佳時段時起點維持現在。
 */
export function alignedWindow(s: DepartureSuggestion): { from: Date; to: Date } {
  const from = Date.parse(s.from);
  const to = Date.parse(s.to);
  const alignedFrom = s.nowIsBest ? from : Math.ceil(from / HALF_HOUR_MS) * HALF_HOUR_MS;
  const alignedTo = Math.floor(to / HALF_HOUR_MS) * HALF_HOUR_MS;
  if (alignedFrom > alignedTo) return { from: new Date(from), to: new Date(to) };
  return { from: new Date(alignedFrom), to: new Date(Math.max(alignedFrom, alignedTo)) };
}

/**
 * 路線卡「建議 X 出發」的時間；建議時段仍是危險天氣時不顯示，
 * 避免判定危險卻寫「建議現在出發」。
 */
export function departureLabelOf(s: RouteBriefing["departureSuggestion"], now: Date): string | null {
  if (!s || s.level === "risky") return null;
  return s.nowIsBest ? "現在" : formatClock(alignedWindow(s).from, now);
}
