import Link from "next/link";
import { AlertTriangle, ArrowRight, HelpCircle, ShieldAlert, ShieldCheck, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { VerdictLevel } from "@/lib/routes/recon-geo";
import type { RouteBriefing } from "@/lib/dashboard/briefing";
import { UnknownReasons } from "@/components/verdict/unknown-reasons";
import { withTrip, type TripParams } from "@/lib/routes/trip";
import { formatRouteAreas, routeAreas } from "@/lib/routes/route-areas";
import { DepartureSuggestionRow } from "./departure-suggestion";
import { DemoNotice } from "@/components/verdict/demo-notice";
import { AiHeadline } from "@/components/verdict/ai-headline";
import { riskyAdvice } from "@/lib/dashboard/advice";

/** 判定牌的顏色跟著狀態走：危險紅、注意琥珀；安全與未判定用中性底，絕不用品牌綠表示危險 */
const LEVEL: Record<
  VerdictLevel,
  { word: string; advice: string; icon: LucideIcon; sign: string; muted: string; chip: string; striped?: boolean }
> = {
  risky: {
    word: "危險",
    // 實際文案由 riskyAdvice 依建議時段產生；這裡只是型別需要的預設
    advice: "建議改期。",
    icon: ShieldAlert,
    sign: "bg-destructive text-destructive-foreground",
    muted: "text-destructive-foreground/85",
    chip: "bg-destructive text-destructive-foreground",
    striped: true,
  },
  caution: {
    word: "注意",
    advice: "可以出發，留意下列路段。",
    icon: AlertTriangle,
    sign: "bg-warning text-warning-foreground",
    muted: "text-warning-foreground/85",
    chip: "bg-warning text-warning-foreground",
    striped: true,
  },
  clear: {
    word: "安全",
    advice: "沿途沒有示警，適合出發。",
    icon: ShieldCheck,
    sign: "border border-border bg-background text-foreground [&_h2]:text-success",
    muted: "text-muted-foreground",
    chip: "bg-accent text-primary",
  },
  unknown: {
    word: "未判定",
    advice: "資料不足，無法判定，不代表安全。",
    icon: HelpCircle,
    sign: "bg-muted text-foreground",
    muted: "text-muted-foreground",
    chip: "bg-muted text-foreground",
  },
};

const tempRange = ({ min, max }: { min: number; max: number }) => (min === max ? `${min}°` : `${min}–${max}°`);

/**
 * 今日判讀主卡：路線名 → 判定牌 → 天氣列 → 建議出發時段 → 詳情入口。
 * 做決定需要的資訊集中在同一張卡。
 */
export function BriefingCard({
  featured,
  trip,
}: {
  featured: RouteBriefing;
  trip: TripParams;
}) {
  const { verdict } = featured;
  const areas = formatRouteAreas(routeAreas(featured.segments));
  const s = LEVEL[verdict.level];
  const Icon = s.icon;
  const hasHazard = verdict.level === "risky" || verdict.level === "caution";

  return (
    <section
      aria-labelledby="verdict-title"
      className="flex flex-col gap-5 rounded-2xl border-2 border-primary bg-card p-5 shadow-[0_14px_30px_-18px_rgb(31_43_32/0.45)] sm:p-6"
    >
      <div>
        <p className="text-xs text-muted-foreground">今日路線</p>
        <p className="text-xl font-black leading-snug sm:text-2xl">{featured.name}</p>
        {areas && <p className="mt-1 text-sm text-muted-foreground">{areas}</p>}
        {featured.demo && <DemoNotice className="mt-2" />}
      </div>

      {/* 判定牌：危險／注意時頂端加警示斜紋，像路邊告示牌，戶外一眼可辨 */}
      <div className={cn("relative flex gap-4 overflow-hidden rounded-xl p-5", s.striped && "pt-7", s.sign)}>
        {s.striped && (
          <span
            aria-hidden
            className="absolute inset-x-0 top-0 h-1.5 bg-[repeating-linear-gradient(-45deg,rgb(0_0_0/0.22)_0_6px,transparent_6px_12px)]"
          />
        )}
        <Icon className="mt-1 size-8 shrink-0" aria-hidden />
        <div className="min-w-0 space-y-2">
          <h2 id="verdict-title" className="text-5xl font-black leading-none tracking-tight">
            {verdict.level === "unknown" ? <UnknownReasons reasons={verdict.reasons}>{s.word}</UnknownReasons> : s.word}
          </h2>
          {hasHazard ? (
            <>
              <AiHeadline routeId={featured.id} trip={trip} verdict={verdict} className="text-lg font-bold" />
              <p className={cn("text-sm", s.muted)}>
                {verdict.level === "risky" ? riskyAdvice(featured) : s.advice}
                {verdict.note && `・${verdict.note}`}
              </p>
            </>
          ) : verdict.level === "unknown" ? (
            <>
              <AiHeadline routeId={featured.id} trip={trip} verdict={verdict} className="text-lg font-bold" />
              <p className={cn("text-sm", s.muted)}>
                {s.advice}
                {verdict.note && `・${verdict.note}`}
              </p>
            </>
          ) : (
            <p className="text-base font-medium">{s.advice}</p>
          )}
        </div>
      </div>

      <div className="space-y-1">
        <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted-foreground">
          <WxItem label="氣溫" value={featured.temperature ? tempRange(featured.temperature) : null} />
          <WxItem label="降雨" value={featured.maxRain != null ? `${featured.maxRain}%` : null} />
          <WxItem label="風速" value={featured.maxWindKmh != null ? `${featured.maxWindKmh} km/h` : null} />
        </dl>
        {featured.periodLabel && (
          <p className="text-xs text-muted-foreground">依 {featured.periodLabel} 預報・中央氣象署</p>
        )}
      </div>

      {featured.departureSuggestion && (
        <DepartureSuggestionRow suggestion={featured.departureSuggestion} routeId={featured.id} trip={trip} />
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-3 border-t border-dashed border-border pt-4 text-sm">
        <Link
          href={withTrip(`/routes?route=${encodeURIComponent(featured.id)}`, trip)}
          className="ml-auto inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-lg bg-primary px-4 font-bold text-primary-foreground transition-colors hover:bg-primary/90"
        >
          看逐段示警與 CCTV
          <ArrowRight className="size-4" aria-hidden />
        </Link>
      </div>
    </section>
  );
}

function WxItem({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <dt>{label}</dt>
      <dd className="font-mono font-semibold text-foreground">{value ?? "—"}</dd>
    </div>
  );
}
