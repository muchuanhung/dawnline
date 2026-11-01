"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Check, ChevronDown, Lock, Star } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { cn } from "@/lib/utils";
import { withTrip, type TripParams } from "@/lib/routes/trip";
import type { SwitcherRoute } from "./route-switcher";

const DESKTOP_QUERY = "(min-width: 1024px)";

/**
 * 「我的路線」切換列最後一顆：就地展開全部收藏與自己上傳的路線，選了直接換判讀，不必離開 Dashboard。
 * 桌機為下拉面板、手機為底部 Drawer（與 SpeedSheet 相同的切換方式），內容相同。
 */
export function MyRoutesMore({
  routes,
  currentId,
  trip,
  chipClassName,
}: {
  /** 全部我的路線（收藏在前），不只切換列上看得到的 5 條 */
  routes: SwitcherRoute[];
  currentId: string;
  trip: TripParams;
  chipClassName: string;
}) {
  const [open, setOpen] = useState(false);
  const [desktop, setDesktop] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(DESKTOP_QUERY);
    setDesktop(mq.matches);
    const onChange = () => setDesktop(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  // Popover toggles itself via PopoverTrigger; the Drawer needs an explicit click handler
  const trigger = (onClick?: () => void) => (
    <button type="button" onClick={onClick} className={chipClassName} aria-haspopup="dialog" aria-expanded={open}>
      全部 {routes.length} 條
      <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} aria-hidden />
    </button>
  );
  const body = <MyRoutesList routes={routes} currentId={currentId} trip={trip} onPick={() => setOpen(false)} />;

  if (desktop) {
    return (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>{trigger()}</PopoverTrigger>
        <PopoverContent align="start" sideOffset={8} className="w-80 rounded-2xl p-2">
          {body}
        </PopoverContent>
      </Popover>
    );
  }
  return (
    <>
      {trigger(() => setOpen(true))}
      <Drawer open={open} onOpenChange={setOpen}>
        <DrawerContent className="bg-card pb-[calc(env(safe-area-inset-bottom)+1rem)]">
          <DrawerHeader className="text-left">
            <DrawerTitle className="text-foreground">我的路線</DrawerTitle>
            <DrawerDescription>選一條看今日判讀</DrawerDescription>
          </DrawerHeader>
          <div className="max-h-[60vh] overflow-y-auto px-2">{body}</div>
        </DrawerContent>
      </Drawer>
    </>
  );
}

/** 分「收藏」「我上傳的」兩組；目前路線打勾；底部連到路線頁管理 */
function MyRoutesList({
  routes,
  currentId,
  trip,
  onPick,
}: {
  routes: SwitcherRoute[];
  currentId: string;
  trip: TripParams;
  onPick: () => void;
}) {
  const groups = [
    { title: "收藏", items: routes.filter((r) => r.mark === "favorite") },
    { title: "我上傳的", items: routes.filter((r) => r.mark !== "favorite") },
  ].filter((g) => g.items.length > 0);

  return (
    <nav aria-label="我的路線">
      {groups.map((g) => (
        <section key={g.title} className="py-1">
          <h3 className="px-3 py-1.5 text-xs font-medium text-muted-foreground">
            {g.title} {g.items.length}
          </h3>
          <ul>
            {g.items.map((r) => {
              const active = r.id === currentId;
              const Icon = r.mark === "favorite" ? Star : Lock;
              return (
                <li key={r.id}>
                  <Link
                    href={withTrip(`/dashboard?route=${encodeURIComponent(r.id)}`, trip)}
                    onClick={onPick}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex min-h-11 items-center gap-2.5 rounded-lg px-3 text-sm transition-colors hover:bg-muted",
                      active && "bg-muted font-semibold"
                    )}
                  >
                    <Icon
                      className={cn("size-4 shrink-0", r.mark === "favorite" ? "fill-amber-400 text-amber-400" : "text-muted-foreground")}
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1 truncate">{r.name}</span>
                    {active && <Check className="size-4 shrink-0 text-primary" aria-label="目前路線" />}
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      <div className="mt-1 border-t border-border px-1 pt-1">
        <Link
          href={withTrip("/routes", trip)}
          onClick={onPick}
          className="flex min-h-11 items-center gap-1 rounded-lg px-2 text-sm font-medium text-primary hover:bg-muted"
        >
          到路線頁管理收藏與上傳
          <ArrowRight className="size-3.5" aria-hidden />
        </Link>
      </div>
    </nav>
  );
}
