"use client";

import { ShieldAlert, AlertTriangle, ShieldCheck, HelpCircle } from "lucide-react";
import { UnknownReasons } from "@/components/verdict/unknown-reasons";
import { cn } from "@/lib/utils";
import type { ReconVerdict, VerdictLevel } from "@/lib/routes/recon-geo";

export const VERDICT_LEVEL_STYLE: Record<
  VerdictLevel,
  { word: string; icon: React.ComponentType<{ className?: string }>; box: string; iconClass: string; wordClass: string }
> = {
  risky: {
    word: "危險",
    icon: ShieldAlert,
    box: "border-destructive bg-destructive/10",
    iconClass: "text-destructive",
    wordClass: "text-destructive",
  },
  caution: {
    word: "注意",
    icon: AlertTriangle,
    box: "border-warning bg-warning/10",
    iconClass: "text-warning",
    wordClass: "text-foreground",
  },
  clear: {
    word: "安全",
    icon: ShieldCheck,
    box: "border-border bg-muted/40",
    iconClass: "text-success",
    wordClass: "text-foreground",
  },
  unknown: {
    word: "未判定",
    icon: HelpCircle,
    box: "border-border bg-muted/40",
    iconClass: "text-muted-foreground",
    wordClass: "text-muted-foreground",
  },
};

/** 第 1 層：全線判定，一行看懂危險等級與原因 */
export function RouteVerdictBar({ verdict }: { verdict: ReconVerdict }) {
  const style = VERDICT_LEVEL_STYLE[verdict.level];
  const Icon = style.icon;

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn("flex items-start gap-3 border-l-4 px-4 py-3", style.box)}
    >
      <Icon className={cn("mt-0.5 h-5 w-5 shrink-0", style.iconClass)} aria-hidden />
      <div className="min-w-0">
        <p className="text-base font-semibold leading-snug text-foreground">
          {verdict.level === "unknown" ? (
            <UnknownReasons reasons={verdict.reasons} className={cn("mr-2 font-bold", style.wordClass)}>
              {style.word}
            </UnknownReasons>
          ) : (
            <span className={cn("mr-2 font-bold", style.wordClass)}>{style.word}</span>
          )}
          {verdict.headline}
        </p>
        {verdict.note && <p className="mt-0.5 text-sm text-muted-foreground">{verdict.note}</p>}
      </div>
    </div>
  );
}
