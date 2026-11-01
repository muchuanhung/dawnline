"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Reorder, useDragControls } from "framer-motion";
import { ArrowRight, Check, ChevronDown, GripVertical, Star } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { cn } from "@/lib/utils";
import { withTrip, type TripParams } from "@/lib/routes/trip";
import { MY_ROUTES_MAX } from "@/lib/dashboard/my-routes";
import { saveRouteOrder } from "@/lib/dashboard/route-order";
import { savePublicOrder } from "@/lib/dashboard/public-order-storage";
import { useSessionRetry } from "@/hooks/usePrivateRoutes";
import type { SwitcherRoute } from "./route-switcher";

const DESKTOP_QUERY = "(min-width: 1024px)";

/**
 * 切換列最後一顆：就地展開全部路線（我的路線或公開路線），選了直接換判讀、可拖曳排序，不必離開 Dashboard。
 * 桌機為下拉面板、手機為底部 Drawer（與 SpeedSheet 相同的切換方式），內容相同。
 * storage：account 存帳號（後端，跨裝置）；device 存這台裝置的 cookie（未登入的公開路線）。
 */
export function MyRoutesMore({
  routes,
  currentId,
  trip,
  storage,
  chipClassName,
}: {
  /** 全部路線（已依自訂順序），不只切換列上看得到的 5 條 */
  routes: SwitcherRoute[];
  currentId: string;
  trip: TripParams;
  storage: "account" | "device";
  chipClassName: string;
}) {
  const [open, setOpen] = useState(false);
  const [desktop, setDesktop] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const router = useRouter();
  const withSessionRetry = useSessionRetry();
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
  /**
   * 拖曳放開後存檔（帳號：後端；裝置：cookie），再重新整理伺服器資料讓切換列的前幾顆跟著換。
   * 失敗時也重新整理：清單回到已存的順序，並顯示一句錯誤。
   */
  const saveOrder = (ids: string[]) => {
    if (ids.join("|") === routes.map((r) => r.id).join("|")) return;
    setSaveError(null);
    const failed = () => setSaveError("排序沒有存到，請再試一次");
    if (storage === "device") {
      if (!savePublicOrder(ids)) failed();
      router.refresh();
      return;
    }
    withSessionRetry(() => saveRouteOrder(ids))
      .catch(failed)
      .finally(() => router.refresh());
  };
  const body = (
    <MyRoutesList
      routes={routes}
      currentId={currentId}
      trip={trip}
      onPick={() => setOpen(false)}
      onReorder={saveOrder}
      error={saveError}
      footerLabel={storage === "account" ? "到路線頁看更多、管理收藏" : "到路線頁看更多"}
    />
  );

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
            <DrawerTitle className="text-foreground">{storage === "account" ? "我的路線" : "公開路線"}</DrawerTitle>
            <DrawerDescription>選一條看今日判讀</DrawerDescription>
          </DrawerHeader>
          <div className="max-h-[60vh] overflow-y-auto px-2">{body}</div>
        </DrawerContent>
      </Drawer>
    </>
  );
}

/**
 * 一個清單（收藏與上傳不分組，收藏加 ★）；目前路線打勾；底部連到路線頁管理。
 * 按住右側把手拖曳排序（framer-motion Reorder，滑鼠與觸控皆可）；前 MY_ROUTES_MAX 條就是切換列上的路線。
 * 只有把手能拖，手機上下捲動清單不會誤觸；放開時呼叫 onReorder 存檔。
 */
function MyRoutesList({
  routes,
  currentId,
  trip,
  onPick,
  onReorder,
  error,
  footerLabel,
}: {
  routes: SwitcherRoute[];
  currentId: string;
  trip: TripParams;
  onPick: () => void;
  /** 放開時的新順序（id）；存檔方式由呼叫端決定 */
  onReorder: (ids: string[]) => void;
  /** 最近一次存檔失敗的訊息 */
  error: string | null;
  footerLabel: string;
}) {
  const [items, setItems] = useState(routes);
  // Server data changed (new favourite, refresh after save): start from it again
  useEffect(() => setItems(routes), [routes]);
  // Leave a star-sized gap on non-favourites only when some row has a star, so names line up
  const hasStars = routes.some((r) => r.mark === "favorite");
  // Latest order for onDragEnd, which may fire with a closure from before the last reorder
  const latest = useRef(items);
  latest.current = items;

  return (
    <nav aria-label="全部路線">
      {error && (
        <p role="alert" className="px-3 pb-1.5 text-xs font-medium text-destructive">
          {error}
        </p>
      )}
      {/* data-vaul-no-drag：在手機 Drawer 裡拖曳排序時不要把 Drawer 拉下來 */}
      {/* The ⋮⋮ handle is a familiar drag cue, so no instruction line; the dashed divider marks the first MY_ROUTES_MAX */}
      <Reorder.Group axis="y" values={items} onReorder={setItems} as="ul" className="space-y-1" data-vaul-no-drag>
        {items.map((r, i) => (
          <SortableRow
            key={r.id}
            route={r}
            active={r.id === currentId}
            href={withTrip(`/dashboard?route=${encodeURIComponent(r.id)}`, trip)}
            onPick={onPick}
            onDragEnd={() => onReorder(latest.current.map((x) => x.id))}
            dividerAfter={i === MY_ROUTES_MAX - 1 && items.length > MY_ROUTES_MAX}
            alignStars={hasStars}
          />
        ))}
      </Reorder.Group>
      <div className="mt-1 border-t border-border px-1 pt-1">
        <Link
          href={withTrip("/routes", trip)}
          onClick={onPick}
          className="flex min-h-11 items-center gap-1 rounded-lg px-2 text-sm font-medium text-primary hover:bg-muted"
        >
          {footerLabel}
          <ArrowRight className="size-3.5" aria-hidden />
        </Link>
      </div>
    </nav>
  );
}

/** 滑鼠按住移動超過這個距離（px）才開始拖曳，未達就是點選 */
const MOUSE_DRAG_SLOP = 4;
/** 觸控長按多久（ms）開始拖曳；之前手指移動超過 TOUCH_MOVE_CANCEL 視為捲動 */
const TOUCH_HOLD_MS = 250;
const TOUCH_MOVE_CANCEL = 8;

/**
 * 整列都能拖：滑鼠按住移動即拖；觸控長按後拖（短按是點選、直接滑是捲動清單）。
 * 拖過的那次放開不觸發連結點選。
 */
function useRowDrag(controls: ReturnType<typeof useDragControls>) {
  const pending = useRef<{ event: PointerEvent; x: number; y: number; timer?: number } | null>(null);
  const dragging = useRef(false);
  const dragged = useRef(false);

  // While a touch drag is active, block the page/list from scrolling under the finger
  useEffect(() => {
    const block = (e: TouchEvent) => {
      if (dragging.current) e.preventDefault();
    };
    window.addEventListener("touchmove", block, { passive: false });
    return () => window.removeEventListener("touchmove", block);
  }, []);

  const clear = () => {
    if (pending.current?.timer) window.clearTimeout(pending.current.timer);
    pending.current = null;
  };
  const start = () => {
    const p = pending.current;
    if (!p) return;
    clear();
    dragging.current = true;
    dragged.current = true;
    controls.start(p.event);
  };

  return {
    onPointerDown(e: React.PointerEvent) {
      if (e.button !== 0) return;
      dragged.current = false;
      clear();
      pending.current = { event: e.nativeEvent, x: e.clientX, y: e.clientY };
      if (e.pointerType !== "mouse") {
        pending.current.timer = window.setTimeout(() => {
          navigator.vibrate?.(10);
          start();
        }, TOUCH_HOLD_MS);
      }
    },
    onPointerMove(e: React.PointerEvent) {
      const p = pending.current;
      if (!p) return;
      const moved = Math.hypot(e.clientX - p.x, e.clientY - p.y);
      if (e.pointerType === "mouse") {
        if (moved > MOUSE_DRAG_SLOP) start();
      } else if (moved > TOUCH_MOVE_CANCEL) {
        clear(); // finger moved before the hold finished: it is a scroll
      }
    },
    onPointerUp: clear,
    onPointerCancel: clear,
    onDragEnd() {
      dragging.current = false;
    },
    // A drag ends with a click on the row's link: swallow it so dropping does not navigate
    onClickCapture(e: React.MouseEvent) {
      if (!dragged.current) return;
      dragged.current = false;
      e.preventDefault();
      e.stopPropagation();
    },
  };
}

function SortableRow({
  route: r,
  active,
  href,
  onPick,
  onDragEnd,
  dividerAfter,
  alignStars,
}: {
  route: SwitcherRoute;
  active: boolean;
  href: string;
  onPick: () => void;
  onDragEnd: () => void;
  /** 第 MY_ROUTES_MAX 條下方畫分隔線：線上方的路線出現在切換列 */
  dividerAfter: boolean;
  /** 清單裡有收藏時，沒星號的列留同寬空位 */
  alignStars: boolean;
}) {
  const controls = useDragControls();
  const drag = useRowDrag(controls);
  return (
    <Reorder.Item
      value={r}
      dragListener={false}
      dragControls={controls}
      onDragEnd={() => {
        drag.onDragEnd();
        onDragEnd();
      }}
      className={cn("relative bg-popover", dividerAfter && "border-b border-dashed border-border pb-1")}
      whileDrag={{ scale: 1.02, boxShadow: "0 8px 20px -8px rgb(0 0 0 / 0.25)", borderRadius: 8, zIndex: 10 }}
    >
      {/* select-none / no touch callout: a long press starts a drag instead of selecting text or opening the link menu */}
      <div
        onPointerDown={drag.onPointerDown}
        onPointerMove={drag.onPointerMove}
        onPointerUp={drag.onPointerUp}
        onPointerCancel={drag.onPointerCancel}
        onClickCapture={drag.onClickCapture}
        onContextMenu={(e) => e.preventDefault()}
        className={cn(
          "flex min-h-11 cursor-grab select-none items-center rounded-lg transition-colors [-webkit-touch-callout:none] active:cursor-grabbing",
          active ? "bg-muted" : "hover:bg-muted/50"
        )}
      >
        <Link
          href={href}
          onClick={onPick}
          draggable={false}
          aria-current={active ? "page" : undefined}
          className={cn("flex min-h-11 min-w-0 flex-1 cursor-[inherit] items-center gap-2.5 pl-3 text-sm", active && "font-semibold")}
        >
          {/* 收藏才有星號；清單有收藏時其他列留同寬空位，名稱對齊 */}
          {r.mark === "favorite" ? (
            <Star className="size-4 shrink-0 fill-amber-400 text-amber-400" aria-label="收藏" />
          ) : (
            alignStars && <span className="size-4 shrink-0" aria-hidden />
          )}
          <span className="min-w-0 flex-1 truncate">{r.name}</span>
          {active && <Check className="size-4 shrink-0 text-primary" aria-label="目前路線" />}
        </Link>
        {/* ⋮⋮ 只是可拖曳的提示；按住它立即開始拖（不用長按） */}
        <span
          aria-hidden
          onPointerDown={(e) => {
            e.stopPropagation();
            controls.start(e);
          }}
          className="flex size-11 shrink-0 touch-none items-center justify-center text-muted-foreground"
        >
          <GripVertical className="size-4" />
        </span>
      </div>
    </Reorder.Item>
  );
}
