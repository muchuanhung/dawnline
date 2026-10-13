"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import type { CctvMarker } from "@/lib/routes/recon-geo";
import Spinner from "@/components/ui/Spinner";

/** 沿途監視器清單：點選後游標跳到該鏡頭的里程 */
export function CctvStrip({
  markers,
  activeId,
  loading,
  error,
  onSelect,
}: {
  markers: CctvMarker[];
  activeId: string | null;
  loading: boolean;
  error: boolean;
  onSelect: (km: number) => void;
}) {
  const itemRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const scrollerRef = useRef<HTMLDivElement>(null);

  // 主畫面鏡頭改變時，只在縮圖列內水平捲動；不可用 scrollIntoView，
  // 它會連帶垂直捲動整頁，把最上層的判定列捲出畫面
  useEffect(() => {
    const el = activeId ? itemRefs.current.get(activeId) : null;
    const scroller = scrollerRef.current;
    if (!el || !scroller) return;
    const elRect = el.getBoundingClientRect();
    const boxRect = scroller.getBoundingClientRect();
    const delta = elRect.left - boxRect.left - (boxRect.width - elRect.width) / 2;
    scroller.scrollBy({ left: delta, behavior: "smooth" });
  }, [activeId]);

  if (loading && markers.length === 0) {
    return (
      <div className="flex h-14 items-center justify-center" role="status" aria-label="監視器載入中">
        <Spinner size="sm" dotClassName="bg-primary" />
      </div>
    );
  }

  if (markers.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">{error ? "監視器載入失敗" : "沿途無監視器"}</p>
    );
  }

  return (
    <section aria-labelledby="cctv-strip-title" className="space-y-2">
      <h3 id="cctv-strip-title" className="text-sm font-semibold text-foreground">
        沿途監視器
        <span className="ml-1.5 font-normal tabular-nums text-muted-foreground">{markers.length}</span>
      </h3>
      {/* relative：讓縮圖內 sr-only（絕對定位）以此為包含區塊並被裁切，否則會撐寬整頁 */}
      <div ref={scrollerRef} className="relative max-w-full overflow-x-auto overscroll-x-contain pb-1">
        <div className="flex w-max gap-2">
          {markers.map((m) => {
            const isActive = m.id === activeId;
            return (
              <button
                key={m.id}
                type="button"
                ref={(el) => {
                  if (el) itemRefs.current.set(m.id, el);
                  else itemRefs.current.delete(m.id);
                }}
                onClick={() => onSelect(m.km)}
                aria-current={isActive ? "true" : undefined}
                className={cn(
                  "flex w-36 shrink-0 flex-col items-start gap-0.5 rounded-md border px-3 py-2 text-left transition-colors cursor-pointer",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  isActive ? "border-foreground bg-muted/60" : "border-border hover:bg-muted/40"
                )}
              >
                <span className="font-mono text-xs tabular-nums text-muted-foreground">
                  {m.km.toFixed(1)} km
                </span>
                <span className="w-full truncate text-sm text-foreground">{m.name}</span>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
