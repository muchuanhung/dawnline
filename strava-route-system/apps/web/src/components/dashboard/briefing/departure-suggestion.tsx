import Link from "next/link";
import { Clock } from "lucide-react";
import type { DepartureSuggestion } from "@/lib/dashboard/briefing";
import { SUGGEST_HORIZON_H } from "@/lib/dashboard/briefing";
import { formatClock, withTrip, type TripParams } from "@/lib/routes/trip";
import { alignedWindow } from "@/lib/dashboard/advice";

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
 * 建議出發時段：伺服器從「現在」起對未來每 30 分鐘的出發時間各跑一次判讀，挑天氣示警最輕的最早區間。
 * 與畫面上選的出發時間無關，所以文案寫明「現在起 N 小時內」，避免被當成依選的時間判定。
 * 只比較天氣（路況事件以現在為準），所以文案不說「安全」。時間對齊整點／半點顯示（見 alignedWindow）。
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
  const clock = (d: Date) => formatClock(d, now);
  const shown = alignedWindow(s);
  const fromLabel = clock(shown.from);
  // 起訖同一天（例如都是「明日」）時，結束時間不再重複日期前綴
  const toLabel = sameDayPrefix(fromLabel, clock(shown.to));
  const single = shown.from.getTime() === shown.to.getTime();
  const levelText = LEVEL_TEXT[s.level ?? "none"];
  const chosenInWindow = trip.depart ? inWindow(trip.depart, s) : s.nowIsBest;
  const target = s.nowIsBest ? null : shown.from.toISOString();
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

  // 時間一段一段不拆行（whitespace-nowrap），只在段與段之間換行
  const range = (
    <>
      <span className="whitespace-nowrap">{fromLabel}</span>
      {!single && (
        <>
          –<span className="whitespace-nowrap">{toLabel}</span>
        </>
      )}
    </>
  );

  // 方案 C：左邊三行（標題／時段／示警），右邊短按鈕；手機與桌機同一個版型，時段不從中間斷行
  return (
    <div className="flex items-center gap-3 rounded-lg bg-muted/50 px-3 py-2.5 text-sm">
      <div className="min-w-0 flex-1">
        <p className="text-xs text-muted-foreground">{SUGGEST_HORIZON_H} 小時內最佳出發</p>
        <p className="font-mono text-base font-semibold">
          {s.nowIsBest && !trip.depart ? (
            <>
              <span className="whitespace-nowrap">現在</span>（{range}）
            </>
          ) : (
            range
          )}
        </p>
        <p className="text-xs text-muted-foreground">{levelText}</p>
      </div>
      {!chosenInWindow && (
        <Link
          href={href}
          aria-label={target ? `改成 ${fromLabel} 出發` : "改回現在出發"}
          className="shrink-0 whitespace-nowrap rounded-lg bg-primary px-3 py-2 font-medium text-primary-foreground hover:bg-primary/90"
        >
          {target ? "改這時間" : "改回現在"}
        </Link>
      )}
    </div>
  );
}

/** 「明日 06:30」與「明日 11:00」→ 結束時間只留「11:00」；不同天時照原樣 */
function sameDayPrefix(from: string, to: string): string {
  const space = from.indexOf(" ");
  if (space < 0) return to;
  const prefix = from.slice(0, space + 1);
  return to.startsWith(prefix) ? to.slice(prefix.length) : to;
}
