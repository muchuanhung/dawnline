"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Route } from "@/lib/routes/route-data";
import { getStatusColor, getStatusLabel } from "@/lib/routes/route-data";

/** AppShell 頂部導覽的高度（h-16），不含瀏海安全區 */
const APP_HEADER_PX = 64;

/** 路線卡上緣到路線名下緣的距離（p-4 + 一行 text-lg）；路線名被頂部導覽蓋住就換成懸浮列 */
const TITLE_BOTTOM_PX = 44;
/** 每捲過路線卡約 5% 回報一次，換成懸浮列的時機才跟得上捲動，不必等整張卡捲出去 */
const THRESHOLDS = Array.from({ length: 21 }, (_, i) => i / 20);

/**
 * 路線卡（anchor）的路線名往上捲進頂部導覽下方後為 true；捲回來、或路線卡還在畫面下方時為 false。
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
        // 路線名已被導覽蓋住（卡片上緣超過導覽下緣一段）才算捲過；位於下方表示還沒捲到
        setPast(entry.boundingClientRect.top < APP_HEADER_PX - TITLE_BOTTOM_PX);
      },
      { rootMargin: `-${APP_HEADER_PX}px 0px 0px 0px`, threshold: THRESHOLDS }
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
        // 底色用頁面底色（不透明），和上方狀態列／頂部導覽同色，不會因下方深色影像透成灰色；
        // 下緣陰影＋下方 24px 圓角讓它和下方內容分得出前後。
        // 懸浮列蓋在頂部導覽上，展開時把頂部導覽藏起來（data-route-sticky，見 global.css），圓角露出的地方才不會透出導覽的分隔線
        <motion.div
          data-route-sticky
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
          className="fixed inset-x-0 top-0 z-40 lg:hidden"
        >
          <div className="rounded-b-3xl border-b border-border bg-background pt-[env(safe-area-inset-top)] shadow-[0_8px_20px_-12px_rgb(0_0_0/0.45)] dark:shadow-[0_8px_24px_-10px_rgb(0_0_0/0.8)]">
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
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
