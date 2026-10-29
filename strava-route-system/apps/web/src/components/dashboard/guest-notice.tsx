import Link from "next/link";
import { LogIn } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * 未登入看今日判讀時的提示：說明現在看的是公開路線，並給登入入口。
 * 登入與否由伺服器的 session cookie 判斷，頁面渲染時就決定，不會先閃一下再消失。
 * 桌機頂部帳號選單已有登入按鈕，這裡的按鈕只在手機顯示（手機頂部沒有帳號選單），同一畫面只會有一個登入入口。
 */
export function GuestNotice() {
  return (
    <section
      aria-label="未登入"
      className="mb-6 flex flex-col gap-3 rounded-2xl border border-border bg-card px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
    >
      <p className="text-sm text-muted-foreground">
        目前顯示公開路線的判讀。<span className="text-foreground">登入後可收藏路線、上傳自己的 GPX。</span>
      </p>
      <Button asChild variant="outline" className="h-10 shrink-0 rounded-full px-4 md:hidden">
        <Link href="/login">
          <LogIn aria-hidden />
          登入
        </Link>
      </Button>
    </section>
  );
}
