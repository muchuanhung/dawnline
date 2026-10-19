import { cn } from "@/lib/utils";

/**
 * 公開路線卡與私人路線卡共用的外框、hover、選取樣式。
 * 清單面板本身是 bg-card，hover 改用 secondary 才看得出來。
 * selectedOn="desktop"：只在桌機顯示選取（私人路線在手機點了會換頁，不需要選取狀態）。
 */
export function routeCardClassName({
  selected,
  selectedOn = "all",
  className,
}: {
  selected: boolean;
  selectedOn?: "all" | "desktop";
  className?: string;
}) {
  return cn(
    "rounded-xl border p-3.5 transition-colors",
    !selected && "border-border/40 bg-card/40 hover:border-border hover:bg-secondary/60",
    selected && selectedOn === "all" && "border-strava/30 bg-strava/8 ring-1 ring-strava/20",
    selected &&
      selectedOn === "desktop" &&
      "border-border/40 bg-card/40 hover:border-border hover:bg-secondary/60 lg:border-strava/30 lg:bg-strava/8 lg:ring-1 lg:ring-strava/20 lg:hover:border-strava/30 lg:hover:bg-strava/8",
    className
  );
}
