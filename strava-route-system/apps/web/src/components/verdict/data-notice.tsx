import { cn } from "@/lib/utils";

/** 判讀時間以台北時間顯示；伺服器與瀏覽器時區可能不同，固定時區才不會前後不一致 */
const CLOCK = new Intl.DateTimeFormat("zh-TW", {
  timeZone: "Asia/Taipei",
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/**
 * 資料時間與免責：判定是工具給的參考，被信任之後說錯一次的代價最高，所以在看得到判定的地方就要講清楚。
 * 入口頁精選路線與今日判讀共用。
 */
export function DataNotice({ generatedAt, className }: { generatedAt: string; className?: string }) {
  return (
    <p className={cn("text-xs leading-relaxed text-muted-foreground", className)}>
      資料時間 {CLOCK.format(new Date(generatedAt))}
      ・來源：中央氣象署鄉鎮預報與測站雨量、TDX 路況事件
      <br />
      判定僅供行前參考，請以現場狀況與官方封路公告為準；未判定不代表安全。
    </p>
  );
}
