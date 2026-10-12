import { cn } from "@/lib/utils";

/** 依台灣時間問候（伺服器在 UTC 也正確） */
export function greeting(now = new Date()): string {
  const hour = Number(
    new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone: "Asia/Taipei" }).format(now)
  );
  if (hour >= 5 && hour < 11) return "早安";
  if (hour >= 11 && hour < 18) return "午安";
  return "晚安";
}

/**
 * 今日判讀頁首（問候＋出發時間標題）。
 * placeholder：換頁 loading.tsx 用，只佔同樣高度不顯示文字，讓下方 spinner 和頁面載入後的位置一致。
 */
export function DashboardHeader({ title, placeholder = false }: { title: string; placeholder?: boolean }) {
  return (
    <header className={cn("mb-6 space-y-1", placeholder && "invisible")} aria-hidden={placeholder || undefined}>
      <p className="text-sm text-muted-foreground">{greeting()}</p>
      <h1 className="text-2xl font-black tracking-tight sm:text-3xl">{title}</h1>
    </header>
  );
}
