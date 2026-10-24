import { CloudRain, Wind, CloudLightning, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Hazard, HazardKind, HazardLevel } from "@/lib/routes/recon-geo";
import type { HazardGroup } from "@/lib/routes/route-track";

/**
 * 示警的共用外觀：今日判讀摘要、路線頁軌道的示警說明與沿途示警時間軸都用這一組。
 * 顏色規則：危險＝實心紅 chip、注意＝琥珀外框 chip；色條、圖示、文字同一色系，
 * 另有「危險／注意」字樣，不只靠顏色辨識。
 * 外層由呼叫端決定（li 或 button），列的內容格線用 HAZARD_ROW_GRID。
 * eta 為預估到達時間（已格式化），由呼叫端依出發時間與均速算好傳入。
 */

export const KIND_ICON: Record<HazardKind, React.ComponentType<{ className?: string }>> = {
  rain: CloudRain,
  wind: Wind,
  storm: CloudLightning,
  event: TriangleAlert,
};

export const LEVEL_WORD: Record<HazardLevel, string> = { risky: "危險", caution: "注意" };

/** 色條｜里程｜等級＋指標 */
export const HAZARD_ROW_GRID = "grid w-full grid-cols-[4px_4.5rem_1fr] items-center gap-3 py-2.5 pr-2 text-left";

const km1 = (value: number) => value.toFixed(1);

/** 里程（路段寫起訖），下方附預估到達時間（有提供時） */
function KmCell({ startKm, endKm, eta }: { startKm: number; endKm: number; eta?: string }) {
  return (
    <span className="flex flex-col font-mono text-sm leading-tight tabular-nums text-muted-foreground">
      <span>{endKm - startKm >= 0.05 ? `${km1(startKm)}–${km1(endKm)}` : `${km1(startKm)} km`}</span>
      {eta && (
        <span className="text-xs">
          <span className="sr-only">預計抵達 </span>
          {eta}
        </span>
      )}
    </span>
  );
}

/** 一個指標：危險實心、注意外框 */
export function HazardChip({ hazard }: { hazard: Hazard }) {
  const Icon = KIND_ICON[hazard.kind];
  const risky = hazard.level === "risky";
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 rounded-full border-[1.5px] px-2.5 py-1 text-[13px] leading-snug",
        risky ? "border-destructive bg-destructive font-semibold text-card" : "border-warning font-medium text-warning-strong"
      )}
    >
      <Icon className="size-3.5 shrink-0" />
      <span className="min-w-0">{hazard.label}</span>
      <span className="sr-only">（{LEVEL_WORD[hazard.level]}）</span>
    </span>
  );
}

/** 等級字樣＋同一處的指標 chip */
export function HazardGroupBody({ group, extra }: { group: HazardGroup; extra?: React.ReactNode }) {
  return (
    <span className="flex min-w-0 flex-col gap-1.5">
      <span className="flex items-center gap-2 text-xs font-bold">
        <span className={group.level === "risky" ? "text-destructive" : "text-warning-strong"}>
          {LEVEL_WORD[group.level]}
        </span>
        {extra}
        {group.hazards.length > 1 && (
          <span className="font-normal tabular-nums text-muted-foreground">{group.hazards.length} 項</span>
        )}
      </span>
      <span className="flex flex-wrap gap-1.5">
        {group.hazards.map((h) => (
          <HazardChip key={h.id} hazard={h} />
        ))}
      </span>
    </span>
  );
}

/** 一段示警（hazardGroups 的一組）一列：色條取最嚴重等級，里程與時間只寫一次 */
export function HazardGroupRowContent({ group, eta }: { group: HazardGroup; eta?: string }) {
  return (
    <>
      <span
        className={cn("h-full min-h-6 rounded-full", group.level === "risky" ? "bg-destructive" : "bg-warning")}
        aria-hidden
      />
      <KmCell startKm={group.startKm} endKm={group.endKm} eta={eta} />
      <HazardGroupBody group={group} />
    </>
  );
}
