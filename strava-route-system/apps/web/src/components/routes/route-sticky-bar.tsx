"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Route } from "@/lib/routes/route-data";
import { getStatusColor, getStatusLabel } from "@/lib/routes/route-data";

/** AppShell 頂部導覽的高度（h-16），不含瀏海安全區 */
const APP_HEADER_PX = 64;

/**
 * 路線卡（anchor）往上捲出頂部導覽下緣後為 true；捲回來、或路線卡還在畫面下方時為 false。
 * 用 IntersectionObserver，不在每次 scroll 事件計算版面
 */
function useScrolledPast(el: HTMLElement | null): boolean {
  const [past, setPast] = useState(false);
  useEffect(() => {
    setPast(false);
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return;
        // 不在可視範圍且位於上方（top < 導覽下緣）才算捲過；位於下方表示還沒捲到
        setPast(!entry.isIntersecting && entry.boundingClientRect.top < APP_HEADER_PX);
      },
      { rootMargin: `-${APP_HEADER_PX}px 0px 0px 0px` }
    );
    observer.observe(el);
    return () => observer.disconnect();
    // 換路線時路線卡重新掛載（AnimatePresence 等舊的淡出後才掛新的），元素換了就重新觀察
  }, [el]);
  return past;
}

/**
 * 手機／平板（< lg）往下捲過路線卡後，蓋在頂部導覽上的懸浮列：判定色點＋路線名＋路線列表。
 * 不多佔畫面高度；點路線名捲回頂端，捲回去後自動收起、還原頂部導覽。
 * 判定顏色與文字沿用路線卡（getStatusColor／getStatusLabel），未判定只顯示灰點
 */
export function RouteStickyBar({
  anchor,
  route,
  status,
  onOpenList,
}: {
  /** 路線卡外層（以 callback ref 取得）；捲過它才出現 */
  anchor: HTMLElement | null;
  route: Route | undefined;
  /** 伺服器判定；null 為未判定 */
  status: Route["status"] | null;
  onOpenList: () => void;
}) {
  const scrolledPast = useScrolledPast(anchor);

  return (
    <AnimatePresence>
      {scrolledPast && route && (
        // 卡片底色＋下緣陰影：頁面底色與頂部導覽同色，懸浮後要和下方內容分得出前後
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.18 }}
          className="fixed inset-x-0 top-0 z-40 border-b border-border bg-card/95 pt-[env(safe-area-inset-top)] shadow-[0_8px_20px_-12px_rgb(0_0_0/0.45)] backdrop-blur-sm dark:shadow-[0_8px_24px_-10px_rgb(0_0_0/0.8)] lg:hidden"
        >
          <div className="mx-auto flex h-16 max-w-6xl items-center gap-2.5 px-4 sm:px-6">
            <button
              type="button"
              onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
              aria-label={`${route.name}，${status ? getStatusLabel(status) : "未判定"}，回到頂端`}
              className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left"
            >
              <span
                className="size-2.5 shrink-0 rounded-full bg-muted-foreground/40"
                style={status ? { backgroundColor: getStatusColor(status) } : undefined}
                aria-hidden
              />
              <span className="truncate text-base font-bold text-foreground">{route.name}</span>
            </button>
            <Button variant="outline" size="sm" className="shrink-0 gap-1.5" onClick={onOpenList}>
              <SlidersHorizontal className="size-3.5" aria-hidden />
              路線列表
            </Button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
