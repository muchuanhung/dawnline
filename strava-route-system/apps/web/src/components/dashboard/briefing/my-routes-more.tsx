"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Reorder, useDragControls } from "framer-motion";
import { ArrowRight, Check, ChevronDown, GripVertical, Lock, Star } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { cn } from "@/lib/utils";
import { withTrip, type TripParams } from "@/lib/routes/trip";
import { MY_ROUTES_MAX } from "@/lib/dashboard/my-routes";
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

/**
 * 一個清單（收藏與上傳不分組，★／鎖頭標示來源）；目前路線打勾；底部連到路線頁管理。
 * 按住右側把手拖曳排序（framer-motion Reorder，滑鼠與觸控皆可）；前 MY_ROUTES_MAX 條就是切換列上的路線。
 * 只有把手能拖，手機上下捲動清單不會誤觸；放開時呼叫 onReorder 存檔。
 */
function MyRoutesList({
  routes,
  currentId,
  trip,
  onPick,
  onReorder,
}: {
  routes: SwitcherRoute[];
  currentId: string;
  trip: TripParams;
  onPick: () => void;
  /** 放開時的新順序（id）；存檔方式由呼叫端決定 */
  onReorder?: (ids: string[]) => void;
}) {
  const [items, setItems] = useState(routes);
  // Server data changed (new favourite, refresh after save): start from it again
  useEffect(() => setItems(routes), [routes]);

  return (
    <nav aria-label="我的路線">
      <p className="px-3 py-1.5 text-xs text-muted-foreground">按住 ⋮⋮ 拖曳調整順序，前 {MY_ROUTES_MAX} 條顯示在上方</p>
      {/* data-vaul-no-drag：在手機 Drawer 裡拖曳排序時不要把 Drawer 拉下來 */}
      <Reorder.Group axis="y" values={items} onReorder={setItems} as="ul" data-vaul-no-drag>
        {items.map((r, i) => (
          <SortableRow
            key={r.id}
            route={r}
            active={r.id === currentId}
            href={withTrip(`/dashboard?route=${encodeURIComponent(r.id)}`, trip)}
            onPick={onPick}
            onDragEnd={() => onReorder?.(items.map((x) => x.id))}
            dividerAfter={i === MY_ROUTES_MAX - 1 && items.length > MY_ROUTES_MAX}
          />
        ))}
      </Reorder.Group>
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

function SortableRow({
  route: r,
  active,
  href,
  onPick,
  onDragEnd,
  dividerAfter,
}: {
  route: SwitcherRoute;
  active: boolean;
  href: string;
  onPick: () => void;
  onDragEnd: () => void;
  /** 第 MY_ROUTES_MAX 條下方畫分隔線：線上方的路線出現在切換列 */
  dividerAfter: boolean;
}) {
  const controls = useDragControls();
  const Icon = r.mark === "favorite" ? Star : Lock;
  return (
    <Reorder.Item
      value={r}
      dragListener={false}
      dragControls={controls}
      onDragEnd={onDragEnd}
      className={cn("relative bg-popover", dividerAfter && "mb-1 border-b border-dashed border-border pb-1")}
      whileDrag={{ scale: 1.02, boxShadow: "0 8px 20px -8px rgb(0 0 0 / 0.25)", borderRadius: 8, zIndex: 10 }}
    >
      <div className={cn("flex min-h-11 items-center rounded-lg transition-colors hover:bg-muted", active && "bg-muted")}>
        <Link
          href={href}
          onClick={onPick}
          aria-current={active ? "page" : undefined}
          className={cn("flex min-h-11 min-w-0 flex-1 items-center gap-2.5 pl-3 text-sm", active && "font-semibold")}
        >
          <Icon
            className={cn("size-4 shrink-0", r.mark === "favorite" ? "fill-amber-400 text-amber-400" : "text-muted-foreground")}
            aria-label={r.mark === "favorite" ? "收藏" : "私人路線"}
          />
          <span className="min-w-0 flex-1 truncate">{r.name}</span>
          {active && <Check className="size-4 shrink-0 text-primary" aria-label="目前路線" />}
        </Link>
        <button
          type="button"
          aria-label={`拖曳調整「${r.name}」的順序`}
          onPointerDown={(e) => controls.start(e)}
          className="flex size-11 shrink-0 cursor-grab touch-none items-center justify-center text-muted-foreground active:cursor-grabbing"
        >
          <GripVertical className="size-4" aria-hidden />
        </button>
      </div>
    </Reorder.Item>
  );
}
