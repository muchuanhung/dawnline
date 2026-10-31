"use client";

import type { ReactNode } from "react";
import { motion } from "framer-motion";
import { Pencil } from "lucide-react";
import { DemoNotice } from "@/components/verdict/demo-notice";
import type { Route } from "@/lib/routes/route-data";
import type { VerdictLevel } from "@/lib/routes/recon-geo";
import { ROUTE_TYPE_ICONS } from "@/constants";
import { formatRouteAreas, routeAreas } from "@/lib/routes/route-areas";

/** 伺服器判定 → 卡片／標頭狀態；未判定為 null（route.status 為 GPX 寫死值，不使用） */
export function statusOfVerdict(level: VerdictLevel): Route["status"] | null {
  if (level === "risky" || level === "caution") return level;
  return level === "clear" ? "safe" : null;
}

interface RouteHeaderProps {
  route: Route;
  /** 伺服器試算未來 12 小時天氣最佳的出發時間（已格式化）；null 不顯示 */
  departureLabel?: string | null;
  /**
   * 依運動類型與平地均速（含爬升修正）估的整條路線時間；與判讀算 ETA 同一套公式。
   * speedLabel 如「一般 20 km/h」，點了打開均速設定面板。未提供時退回 GPX 解析時的粗估。
   */
  estimate?: { totalLabel: string; climbLabel: string | null; speedLabel: string; onEdit: () => void };
  /** 類型標籤旁的操作（收藏星號）；actionError 是該操作失敗的一句話 */
  action?: ReactNode;
  actionError?: string | null;
}

/**
 * 精簡標頭：名稱、經過縣市、類型與一行數據。
 * 判定與路線位置改由下方主視覺（影像＋里程軌道）呈現，這裡不再畫路線形狀圖。
 */
export function RouteHeader({ route, departureLabel, estimate, action, actionError }: RouteHeaderProps) {
  const suggestTime = departureLabel ?? null;
  const TypeIcon = ROUTE_TYPE_ICONS[route.type];
  const areas = formatRouteAreas(routeAreas(route.segments));

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: "easeOut" }}
      className="space-y-3 rounded-2xl border border-border bg-card p-4"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-bold text-foreground text-balance">{route.name}</h2>
          {/* 副標題只列路線經過的縣市；nameZh 多半和名稱重複，不顯示 */}
          {areas && <p className="text-sm text-muted-foreground">{areas}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <div className="flex items-center gap-1.5 rounded-lg bg-secondary/40 px-2.5 py-1.5">
            <TypeIcon className="h-4 w-4 text-strava" />
            <span className="text-xs font-medium text-foreground">{route.type}</span>
          </div>
          {action}
        </div>
      </div>
      {actionError && (
        <p role="status" className="text-xs text-destructive">
          {actionError}
        </p>
      )}

      <p className="text-sm tabular-nums text-muted-foreground">
        <Stat value={`${route.distance}`} unit="km" />
        <Sep />
        爬升 <Stat value={`${route.elevationGain}`} unit="m" />
        <Sep />
        預估 <Stat value={estimate?.totalLabel ?? route.estimatedTime} />
        {estimate?.climbLabel && <span>（坡度 +{estimate.climbLabel}）</span>}
        {suggestTime && (
          <>
            <Sep />
            建議 <Stat value={suggestTime} /> 出發
          </>
        )}
      </p>

      {estimate && (
        <button
          type="button"
          onClick={estimate.onEdit}
          className="inline-flex items-center gap-1 rounded-lg bg-secondary/60 px-2.5 py-1 text-xs font-medium text-primary hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {estimate.speedLabel}
          <Pencil className="h-3 w-3" aria-hidden />
          <span className="sr-only">調整速度</span>
        </button>
      )}

      {route.demo && <DemoNotice />}
    </motion.div>
  );
}

function Stat({ value, unit }: { value: string; unit?: string }) {
  return (
    <span className="font-semibold text-foreground">
      {value}
      {unit && <span className="ml-0.5 font-normal text-muted-foreground">{unit}</span>}
    </span>
  );
}

function Sep() {
  return (
    <span className="mx-1.5" aria-hidden>
      ·
    </span>
  );
}
