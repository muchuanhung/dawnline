import { cache } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { getPublicBriefings } from "@/lib/dashboard/get-briefing.server";
import type { VerdictLevel } from "@/lib/routes/recon-geo";
import { UnknownReasons } from "@/components/verdict/unknown-reasons";
import { DataNotice } from "@/components/verdict/data-notice";
import { reportError } from "@/lib/observability/report";
import { cn } from "@/lib/utils";

const CHIP: Record<VerdictLevel, { word: string; className: string }> = {
  risky: { word: "危險", className: "bg-destructive text-destructive-foreground" },
  caution: { word: "注意", className: "bg-warning text-warning-foreground" },
  clear: { word: "安全", className: "bg-accent text-primary" },
  unknown: { word: "未判定", className: "bg-muted text-foreground" },
};

/** 只放 2 條：3 條時桌機左側約 800px，瀏覽器可用高度 720px 上會出現捲軸 */
const getFeaturedBriefings = cache(() =>
  getPublicBriefings(2).catch((e) => {
    reportError("api", "featured-briefings-failed", e);
    return [];
  })
);

/**
 * 未登入入口頁：精選路線的即時判定，點卡片進 /routes 看逐段判定（公開頁，不用登入）。
 * 取不到資料時整區不顯示，入口頁不放錯誤訊息。
 */
export async function FeaturedRoutes() {
  const briefings = await getFeaturedBriefings();
  if (briefings.length === 0) return null;

  return (
    <section aria-label="精選路線即時與未來狀況判定" className="space-y-3">
      <h2 className="text-lg font-bold text-foreground">精選路線・即時與未來狀況判定</h2>
      <ul className="grid gap-3">
        {briefings.map((b) => {
          const chip = CHIP[b.verdict.level];
          // chip 疊在整張卡的連結上方，未判定的 Popover 才點得到；入口頁的 chip 不加虛線底線（其他頁維持）
          // chip 固定寬度（容得下「未判定」），右側內容 flex-1，各卡標題起點對齊
          const chipClass = cn(
            "relative z-10 w-16 shrink-0 rounded-md py-0.5 text-center text-xs font-black tracking-widest",
            chip.className
          );
          return (
            <li
              key={b.id}
              className="group relative flex items-start gap-3 rounded-xl border border-border bg-card/80 p-4 backdrop-blur transition-colors focus-within:border-primary hover:border-primary/60"
            >
              {b.verdict.level === "unknown" ? (
                <UnknownReasons reasons={b.verdict.reasons} className={cn(chipClass, "no-underline")}>
                  {chip.word}
                </UnknownReasons>
              ) : (
                <span className={chipClass}>{chip.word}</span>
              )}
              <div className="min-w-0 flex-1 space-y-0.5">
                <Link
                  href={`/routes?route=${encodeURIComponent(b.id)}`}
                  className="block font-bold leading-snug outline-none after:absolute after:inset-0 after:rounded-xl transition-colors group-focus-within:text-primary group-hover:text-primary"
                >
                  {b.name}
                </Link>
                <p className="text-sm">{b.verdict.headline}</p>
                <p className="font-mono text-xs text-muted-foreground">
                  {b.distanceKm.toFixed(1)} km・爬升 {b.elevationGainM} m
                  {b.periodLabel && `・依 ${b.periodLabel} 預報`}
                </p>
              </div>
              <ChevronRight
                className="mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                aria-hidden
              />
            </li>
          );
        })}
      </ul>
      <DataNotice generatedAt={briefings[0]!.generatedAt} />
    </section>
  );
}
