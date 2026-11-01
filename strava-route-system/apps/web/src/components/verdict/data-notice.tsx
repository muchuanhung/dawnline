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
 * 手機多半是在戶外移動中看，只留一行：更新時間＋「未判定不代表安全」（產品鐵律，不能拿掉）；
 * 資料來源已在頁尾，桌機（出發前在家看）才顯示完整說明。
 */
export function DataNotice({ generatedAt, className }: { generatedAt: string; className?: string }) {
  const time = CLOCK.format(new Date(generatedAt));
  return (
    <p className={cn("text-xs leading-relaxed text-muted-foreground", className)}>
      <span className="md:hidden">{time} 更新・僅供參考，未判定不代表安全</span>
      <span className="hidden md:inline">
        資料時間 {time}
        ・來源：中央氣象署鄉鎮預報與測站雨量、TDX 路況事件
        <br />
        判定僅供行前參考，請以現場狀況與官方封路公告為準；未判定不代表安全。
      </span>
    </p>
  );
}
