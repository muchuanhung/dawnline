import { cn } from "@/lib/utils";

/** 全站頁尾：品牌與資料來源（政府開放資料需標示出處，手機也保留，只縮成一行） */
export function SiteFooter({ className }: { className?: string }) {
  return (
    <footer className={cn("flex justify-center text-center text-xs text-muted-foreground", className)}>
      <span className="md:hidden">曉行 Dawnline｜資料：中央氣象署、TDX</span>
      <span className="hidden md:inline">曉行 Dawnline｜資料來源：交通部中央氣象署、TDX 運輸資料流通服務</span>
    </footer>
  );
}
