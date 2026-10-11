import Link from "next/link";
import Image from "next/image";
import { LayoutDashboard, Route, User, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { SiteFooter } from "@/components/app-shell/site-footer";
import { UserMenu } from "@/components/app-shell/user-menu";
import { TripNavLink } from "@/components/app-shell/trip-nav-link";

export type AppSection = "dashboard" | "routes" | "profile";

const NAV: { id: AppSection; label: string; href: string; icon: LucideIcon }[] = [
  { id: "dashboard", label: "今日判讀", href: "/dashboard", icon: LayoutDashboard },
  { id: "routes", label: "路線", href: "/routes", icon: Route },
  { id: "profile", label: "個人資料", href: "/profile", icon: User },
];

/** 今日判讀與路線共用行程設定，切頁時帶上記住的設定；個人資料不需要 */
const navLinkFor = (id: AppSection) => (id === "profile" ? Link : TripNavLink);

/** 桌機頂部只放工作區分頁；個人資料屬於帳號，放在右側帳號選單 */
const DESKTOP_NAV = NAV.filter((item) => item.id !== "profile");

/**
 * 全站外框：桌機頂部導覽（左品牌、中間膠囊分頁、右側帳號選單）、手機底部分頁列。
 * 目前頁面由呼叫端以 current 傳入；外框是 Server Component，只有帳號選單需要客戶端 JS（讀登入者資料）。
 */
export function AppShell({ current, children }: { current: AppSection; children: React.ReactNode }) {
  return (
    <div className="min-h-dvh">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-card focus:px-3 focus:py-2"
      >
        跳到主要內容
      </a>

      <header className="sticky top-0 z-30 border-b border-border bg-background/90 backdrop-blur-sm pt-[env(safe-area-inset-top)]">
        <div className="relative mx-auto flex h-16 max-w-6xl items-center justify-between gap-6 px-4 sm:px-6">
          <TripNavLink href="/dashboard" className="flex items-center gap-2.5 font-black tracking-wide text-primary">
            <Image src="/dawnline.svg" alt="" width={32} height={32} className="size-8" priority />
            曉行 Dawnline
          </TripNavLink>
          {/* 膠囊分頁置中，和頁面裡的出發／運動選擇器同一種樣式 */}
          <nav
            aria-label="主要導覽"
            className="absolute left-1/2 hidden -translate-x-1/2 items-center gap-1 rounded-full bg-secondary p-1 md:flex"
          >
            {DESKTOP_NAV.map((item) => {
              const Icon = item.icon;
              const active = item.id === current;
              const NavLink = navLinkFor(item.id);
              return (
                <NavLink
                  key={item.id}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-medium transition-colors",
                    active
                      ? "bg-card text-foreground shadow-sm"
                      : "text-muted-foreground hover:bg-card/60 hover:text-foreground"
                  )}
                >
                  <Icon className="size-4" aria-hidden />
                  {item.label}
                </NavLink>
              );
            })}
          </nav>
          <div className="hidden md:block">
            <UserMenu active={current === "profile"} />
          </div>
        </div>
      </header>

      <main
        id="main-content"
        className="mx-auto max-w-6xl px-4 pb-[calc(env(safe-area-inset-bottom)+6rem)] pt-6 sm:px-6 md:pb-12 md:pt-10"
      >
        {children}
        <SiteFooter className="mt-12 border-t border-border pt-6" />
      </main>

      <nav
        aria-label="主要導覽"
        data-bottom-nav
        className="fixed inset-x-0 bottom-0 z-30 flex border-t border-border bg-card pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        {NAV.map((item) => {
          const Icon = item.icon;
          const active = item.id === current;
          const NavLink = navLinkFor(item.id);
          return (
            <NavLink
              key={item.id}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex flex-1 flex-col items-center gap-1 py-2 text-xs",
                active ? "font-bold text-primary" : "text-muted-foreground"
              )}
            >
              <span className={cn("rounded-full px-4 py-1", active && "bg-accent")}>
                <Icon className="size-5" aria-hidden />
              </span>
              {item.label}
            </NavLink>
          );
        })}
      </nav>
    </div>
  );
}
