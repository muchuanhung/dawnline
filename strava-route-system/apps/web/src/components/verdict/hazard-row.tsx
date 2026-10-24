import { CloudRain, Wind, CloudLightning, TriangleAlert, Construction } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Hazard, HazardKind } from "@/lib/routes/recon-geo";
import { CATEGORY_LABEL, type RouteEvent } from "@/lib/routes/road-events";

/**
 * 示警列的共用外觀：今日判讀（摘要、靜態）與路線頁（完整、可點擊跳到該處）都用這一組。
 * 外層由呼叫端決定（li 或 button），這裡只放列的內容，格線用 HAZARD_ROW_GRID。
 * eta 為預估到達時間（已格式化），由呼叫端依出發時間與均速算好傳入。
 */

export const KIND_ICON: Record<HazardKind, React.ComponentType<{ className?: string }>> = {
  rain: CloudRain,
  wind: Wind,
  storm: CloudLightning,
  event: TriangleAlert,
};

/** 色條｜里程｜圖示＋說明 */
export const HAZARD_ROW_GRID = "grid w-full grid-cols-[4px_4.5rem_1fr] items-center gap-3 py-2.5 pr-2 text-left";

const km = (value: number) => `${value.toFixed(1)} km`;

/** 里程，下方附預估到達時間（有提供時） */
function KmCell({ value, eta }: { value: number; eta?: string }) {
  return (
    <span className="flex flex-col font-mono text-sm leading-tight tabular-nums text-muted-foreground">
      <span>{km(value)}</span>
      {eta && (
        <span className="text-xs">
          <span className="sr-only">預計抵達 </span>
          {eta}
        </span>
      )}
    </span>
  );
}

/** 影響判定的示警：危險紅、注意琥珀，另有文字給螢幕閱讀器，不只靠顏色辨識 */
export function HazardRowContent({ hazard, eta }: { hazard: Hazard; eta?: string }) {
  const Icon = KIND_ICON[hazard.kind];
  const risky = hazard.level === "risky";
  return (
    <>
      <span className={cn("h-full min-h-6 rounded-full", risky ? "bg-destructive" : "bg-warning")} aria-hidden />
      <KmCell value={hazard.startKm} eta={eta} />
      <span className="flex min-w-0 items-center gap-2">
        <Icon className={cn("h-4 w-4 shrink-0", risky ? "text-destructive" : "text-warning-strong")} />
        <span className={cn("truncate text-sm font-medium", risky ? "text-destructive" : "text-foreground")}>
          {hazard.label}
        </span>
        <span className="sr-only">{risky ? "危險" : "注意"}</span>
      </span>
    </>
  );
}

/** 不影響判定的路況（施工、壅塞、活動）：中性色 */
export function NoticeRowContent({ event, eta }: { event: RouteEvent; eta?: string }) {
  return (
    <>
      <span className="h-full min-h-6 rounded-full bg-border" aria-hidden />
      <KmCell value={event.km} eta={eta} />
      <span className="flex min-w-0 items-center gap-2">
        <Construction className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="truncate text-sm">
          {CATEGORY_LABEL[event.category]}：{event.description || event.title}
        </span>
      </span>
    </>
  );
}
