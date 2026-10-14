import { WifiOff } from "lucide-react";
import { formatClock } from "@/lib/routes/trip";
import { snapshotAgeLabel } from "@/lib/routes/snapshot";
import type { RouteBriefingState } from "@/hooks/useRouteBriefing";
import { cn } from "@/lib/utils";

/**
 * 離線快照說明：收不到訊號時判讀停在哪個時間。
 * 過期後明說「安全」已改為未判定，避免使用者把舊的綠色當成現在的狀況。
 */
export function OfflineNotice({
  snapshot,
  className,
}: {
  snapshot: NonNullable<RouteBriefingState["snapshot"]>;
  className?: string;
}) {
  const { savedAt, expired, now } = snapshot;
  const time = `${formatClock(new Date(savedAt), new Date(now))}（${snapshotAgeLabel(savedAt, now)}）`;
  return (
    <p
      role="status"
      className={cn(
        "flex items-start gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs text-foreground",
        expired ? "border-amber-500/60 bg-amber-500/10" : "border-border bg-muted/40",
        className
      )}
    >
      <WifiOff className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      <span>
        <strong className="font-bold">離線中</strong>
        {expired
          ? `：判讀停在 ${time}，超過 30 分鐘沒更新，「安全」已改為未判定，已知示警可能已變化。`
          : `：顯示 ${time}的判讀，有訊號後會自動更新。`}
      </span>
    </p>
  );
}
