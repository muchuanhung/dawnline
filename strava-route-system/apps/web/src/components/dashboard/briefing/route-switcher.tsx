import Link from "next/link";
import { ArrowRight, Lock, Star } from "lucide-react";
import { cn } from "@/lib/utils";
import { withTrip, type TripParams } from "@/lib/routes/trip";

/** 切換列的一條路線；mark 只在登入後的「我的路線」出現：favorite 收藏、private 自己上傳 */
export interface SwitcherRoute {
  id: string;
  name: string;
  mark?: "favorite" | "private";
}

/** 今日判讀只做快速切換；找路線、搜尋、篩選在路線頁 */
const MAX_CHIPS = 5;

/** 前 MAX_CHIPS 條；目前路線不在其中時換掉最後一個，確保看得到正在看哪一條 */
function visibleRoutes<T extends { id: string }>(routes: T[], currentId: string): T[] {
  const head = routes.slice(0, MAX_CHIPS);
  if (head.some((r) => r.id === currentId)) return head;
  const current = routes.find((r) => r.id === currentId);
  return current ? [...head.slice(0, MAX_CHIPS - 1), current] : head;
}

const CHIP =
  "inline-flex min-h-10 max-w-64 items-center gap-1.5 rounded-full border px-4 text-sm font-medium whitespace-nowrap transition-colors";

/**
 * 路線切換：純連結（?route=），可分享、可上一頁，不需客戶端狀態。
 * mine：登入後的「我的路線」（收藏＋自己上傳，T8）；一律附「全部路線」入口，一條也顯示。
 */
export function RouteSwitcher({
  routes,
  currentId,
  trip,
  mine = false,
}: {
  routes: SwitcherRoute[];
  currentId: string;
  trip: TripParams;
  mine?: boolean;
}) {
  if (!mine && routes.length < 2) return null;
  const shown = visibleRoutes(routes, currentId);
  return (
    <nav aria-label="切換路線" className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <ul className="flex w-max gap-2 pb-1">
        {shown.map((r) => {
          const active = r.id === currentId;
          return (
            <li key={r.id}>
              <Link
                href={withTrip(`/dashboard?route=${encodeURIComponent(r.id)}`, trip)}
                aria-current={active ? "page" : undefined}
                className={cn(
                  CHIP,
                  active
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-card text-muted-foreground hover:text-foreground"
                )}
              >
                {r.mark === "favorite" && (
                  <Star className="size-3.5 shrink-0 fill-amber-400 text-amber-400" aria-label="收藏" />
                )}
                {r.mark === "private" && <Lock className="size-3.5 shrink-0" aria-label="私人路線" />}
                <span className="truncate">{r.name}</span>
              </Link>
            </li>
          );
        })}
        {(mine || routes.length > shown.length) && (
          <li>
            <Link href={withTrip("/routes", trip)} className={cn(CHIP, "gap-1 border-dashed border-border text-primary hover:bg-muted/50")}>
              {mine ? "全部路線" : `全部 ${routes.length} 條路線`}
              <ArrowRight className="size-3.5" aria-hidden />
            </Link>
          </li>
        )}
      </ul>
    </nav>
  );
}
