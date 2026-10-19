"use client";

import { useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { settleSwipe, swipeDirection, swipeOffset } from "@/lib/swipe";

/** 與 Tailwind lg 斷點一致；桌機用 ⋮ 選單，不啟用左滑 */
const DESKTOP_QUERY = "(min-width: 1024px)";

/** 操作鈕區塊的寬度（px），兩顆 76px 的按鈕 */
export const SWIPE_ACTIONS_WIDTH = 152;

interface Gesture {
  x: number;
  y: number;
  /** 開始滑動時卡片的位移 */
  base: number;
  direction: "horizontal" | "vertical" | null;
}

/**
 * 手機左滑露出操作鈕（像 iOS 郵件）。只處理觸控；滑鼠與桌機（lg 以上）不啟用，操作鈕也不顯示。
 * 打開狀態由父層管理，方便同時只開一張。打開時點卡片只會收合，不觸發卡片本身的點擊。
 */
export function SwipeActions({
  open,
  onOpenChange,
  actions,
  disabled,
  className,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 滑開後露出的按鈕，總寬應為 SWIPE_ACTIONS_WIDTH */
  actions: ReactNode;
  disabled?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const gesture = useRef<Gesture | null>(null);
  // 滑動結束後若瀏覽器仍送出 click，要吞掉避免誤開路線；每次按下時重設（多數瀏覽器拖曳後不送 click）
  const suppressClick = useRef(false);
  const [dragX, setDragX] = useState<number | null>(null);
  const offset = dragX ?? (open ? -SWIPE_ACTIONS_WIDTH : 0);

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    suppressClick.current = false;
    if (disabled || e.pointerType !== "touch" || window.matchMedia(DESKTOP_QUERY).matches) return;
    gesture.current = { x: e.clientX, y: e.clientY, base: open ? -SWIPE_ACTIONS_WIDTH : 0, direction: null };
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const g = gesture.current;
    if (!g) return;
    const dx = e.clientX - g.x;
    if (g.direction == null) {
      g.direction = swipeDirection(dx, e.clientY - g.y);
      if (g.direction == null) return;
      if (g.direction === "vertical") {
        // 上下捲動交給瀏覽器
        gesture.current = null;
        return;
      }
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    setDragX(swipeOffset(g.base, dx, SWIPE_ACTIONS_WIDTH));
  }

  function onPointerEnd() {
    if (gesture.current?.direction === "horizontal" && dragX != null) {
      suppressClick.current = true;
      onOpenChange(settleSwipe(dragX, SWIPE_ACTIONS_WIDTH));
    }
    gesture.current = null;
    setDragX(null);
  }

  function onClickCapture(e: React.MouseEvent) {
    if (suppressClick.current || open) {
      e.preventDefault();
      e.stopPropagation();
      if (!suppressClick.current) onOpenChange(false);
      suppressClick.current = false;
    }
  }

  return (
    // 桌機不左滑，不裁切，選取時的外框 ring 才不會被切掉
    <div className={cn("relative overflow-hidden rounded-xl lg:overflow-visible", className)}>
      {/* 操作鈕在卡片底下，卡片往左移才露出；收合時隱藏，避免圓角邊緣透出顏色 */}
      <div
        data-swipe-actions
        className={cn("absolute inset-y-0 right-0 flex lg:hidden", offset === 0 && "invisible")}
        style={{ width: SWIPE_ACTIONS_WIDTH }}
        aria-hidden={!open}
      >
        {actions}
      </div>
      <div
        className={cn("relative rounded-xl bg-card", dragX == null && "transition-transform duration-200")}
        // pan-y：上下捲動交給瀏覽器，左右滑動才會送到這裡
        style={{ transform: offset ? `translateX(${offset}px)` : undefined, touchAction: "pan-y" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onClickCapture={onClickCapture}
      >
        {children}
      </div>
    </div>
  );
}
