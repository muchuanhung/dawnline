import { FlaskConical } from "lucide-react";
import { cn } from "@/lib/utils";

/** 示意路線的說明：路線讀不到時的備援，沿途路況事件為假資料；今日判讀與路線頁共用 */
export function DemoNotice({ className }: { className?: string }) {
  return (
    <p
      role="note"
      className={cn(
        "flex items-start gap-1.5 rounded-lg border border-dashed border-amber-500/60 bg-amber-500/10 px-2.5 py-1.5 text-xs text-foreground",
        className
      )}
    >
      <FlaskConical className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      <span>
        <strong className="font-bold">Demo 示意資料</strong>：目前讀不到路線資料，先顯示示意路線。沿途路況事件是假資料，不代表實際路況；天氣仍為即時資料。
      </span>
    </p>
  );
}
