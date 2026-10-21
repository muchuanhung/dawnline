import Link from "next/link";
import { Clock } from "lucide-react";
import type { DepartureSuggestion } from "@/lib/dashboard/briefing";
import { SUGGEST_HORIZON_H } from "@/lib/dashboard/briefing";
import { formatClock, withTrip, type TripParams } from "@/lib/routes/trip";

const LEVEL_TEXT = {
  none: "沿途無天氣示警",
  caution: "沿途天氣最多到注意",
  risky: `未來 ${SUGGEST_HORIZON_H} 小時各時段都有危險天氣`,
} as const;

/** 目前選的出發時間是否落在建議區間內（容許 15 分鐘誤差） */
function inWindow(depart: string, s: DepartureSuggestion): boolean {
  const t = Date.parse(depart);
  return t >= Date.parse(s.from) - 15 * 60_000 && t <= Date.parse(s.to) + 15 * 60_000;
}

/**
 * 建議出發時段：伺服器對未來每 30 分鐘的出發時間各跑一次判讀，挑天氣示警最輕的最早區間。
 * 只比較天氣（路況事件以現在為準），所以文案不說「安全」。
 */
export function DepartureSuggestionRow({
  suggestion: s,
  routeId,
  trip,
}: {
  suggestion: DepartureSuggestion;
  routeId: string;
  trip: TripParams;
}) {
  const now = new Date();
  const clock = (iso: string) => formatClock(new Date(iso), now);
  const range = s.from === s.to ? clock(s.from) : `${clock(s.from)}–${clock(s.to)}`;
  const levelText = LEVEL_TEXT[s.level ?? "none"];
  const chosenInWindow = trip.depart ? inWindow(trip.depart, s) : s.nowIsBest;
  const target = s.nowIsBest ? null : s.from;
  const href = withTrip(`/dashboard?route=${encodeURIComponent(routeId)}`, { depart: target, activity: trip.activity });

  // 各時段都危險：沒有可建議的出發時間，不寫「最佳出發」也不給改時間的連結
  if (s.level === "risky") {
    return (
      <div className="flex items-center gap-3 rounded-lg bg-muted/50 px-3 py-2 text-sm">
        <Clock className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <p className="min-w-0 flex-1 text-muted-foreground">{LEVEL_TEXT.risky}，沒有建議的出發時段</p>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg bg-muted/50 px-3 py-2 text-sm">
      <Clock className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      <p className="min-w-0 flex-1">
        <span className="text-muted-foreground">天氣最佳出發 </span>
        <b className="font-mono">{s.nowIsBest && !trip.depart ? `現在（${range}）` : range}</b>
        <span className="text-muted-foreground">・{levelText}</span>
      </p>
      {!chosenInWindow && (
        <Link href={href} className="shrink-0 font-medium text-primary hover:underline">
          {target ? `改 ${clock(target)} 出發` : "改回現在出發"}
        </Link>
      )}
    </div>
  );
}
