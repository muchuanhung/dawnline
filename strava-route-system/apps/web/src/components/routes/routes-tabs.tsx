import Link from "next/link";
import { Compass, FileUp } from "lucide-react";
import { cn } from "@/lib/utils";

export type RoutesTab = "explore" | "mine";

const TABS: { id: RoutesTab; label: string; href: string; icon: typeof Compass }[] = [
  { id: "explore", label: "探索路線", href: "/routes", icon: Compass },
  { id: "mine", label: "我的路線", href: "/routes/private", icon: FileUp },
];

/**
 * 公開路線與私人路線的分段切換：兩頁放在標題下方同一個位置，目前那頁白底。
 * 「我的路線」未登入時由頁面導到登入頁。
 */
export function RoutesTabs({ current, className }: { current: RoutesTab; className?: string }) {
  return (
    <nav aria-label="路線分類" className={cn("grid w-full grid-cols-2 gap-1 rounded-full bg-secondary p-1 sm:w-80", className)}>
      {TABS.map((t) => {
        const active = t.id === current;
        const Icon = t.icon;
        return (
          <Link
            key={t.id}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "inline-flex items-center justify-center gap-1.5 rounded-full py-2 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              active ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Icon className="size-4" aria-hidden />
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
