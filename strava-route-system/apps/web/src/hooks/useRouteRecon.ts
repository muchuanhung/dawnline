"use client";

import { useCallback, useMemo, useState } from "react";
import type { Route } from "@/lib/routes/route-data";
import { buildRoutePolylineKm } from "@/lib/routes/recon-geo";
import type { Activity } from "@/lib/routes/trip";
import { useRouteCCTV } from "@/hooks/useRouteCCTV";
import { useRouteBriefing, verdictOf } from "@/hooks/useRouteBriefing";
import { useBriefingSummary } from "@/hooks/useBriefingSummary";
import { statusOfVerdict } from "@/components/routes/route-header";

/**
 * 路線偵察畫面的資料：CCTV、里程折線、途中模式里程、判讀與判定狀態。
 * 公開路線頁與私人路線詳情共用；私人路線只換判讀 API（endpoint）。
 */
export function useRouteRecon(
  route: Route | null | undefined,
  trip: { depart: string | null; activity: Activity | null },
  endpoint = "/api/routes/briefing"
) {
  // 途中模式的目前里程，綁定路線：換路線後自動失效，不會把 A 路線的里程套到 B 路線
  // at：套用時間，同一里程定時重新判讀時用來觸發重抓
  const [ahead, setAhead] = useState<{ routeId: string; km: number; at: number } | null>(null);
  const routeId = route?.id;
  const aheadOfRoute = ahead && ahead.routeId === routeId ? ahead : null;
  const aheadKm = aheadOfRoute?.km ?? null;
  const setAheadKm = useCallback(
    (km: number | null) => setAhead(km != null && routeId ? { routeId, km, at: Date.now() } : null),
    [routeId]
  );

  const cctv = useRouteCCTV(route ?? null);
  const polyline = useMemo(() => (route ? buildRoutePolylineKm(route) : null), [route]);
  // 判定、示警、建議時段全由伺服器算，前端只顯示
  const briefing = useRouteBriefing(routeId, trip, aheadKm, aheadOfRoute?.at ?? null, endpoint);
  const verdict = verdictOf(briefing);
  // 還沒有判讀（載入中、失敗）時為 null，懸浮列與路線卡顯示未判定，不當成安全
  const status = briefing.briefing ? statusOfVerdict(verdict.level) : null;
  // AI 一句話摘要：判讀回來後才抓；離線快照與途中模式不抓，維持規則句
  const summary = useBriefingSummary(routeId, trip, endpoint, briefing.briefing != null && !briefing.snapshot && aheadKm == null);

  return { cctv, polyline, aheadKm, setAheadKm, briefing, status, summary };
}

export type RouteRecon = ReturnType<typeof useRouteRecon>;
