"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RoutesLoading } from "@/components/routes/routes-loading";
import { RouteReconBody } from "@/components/routes/route-recon-body";
import { RouteStickyBar } from "@/components/routes/route-sticky-bar";
import { usePrivateRoute } from "@/hooks/usePrivateRoutes";
import { useRouteRecon } from "@/hooks/useRouteRecon";
import type { PageTrip } from "@/lib/routes/trip";
import { cn } from "@/lib/utils";

const PRIVATE_BRIEFING_ENDPOINT = "/api/routes/private/briefing";

/**
 * 私人路線詳情：與公開路線頁同一套偵察畫面（RouteReconBody＋useRouteRecon）與手機懸浮路線列，
 * 只是路線來自使用者上傳的 GPX，判讀改打 /api/routes/private/briefing。
 */
export function PrivateRouteDetail({
  routeId,
  trip,
  embedded = false,
}: {
  routeId: string;
  /** 網址上的行程設定（出發時間 ISO、運動類型），未指定為 null */
  trip: PageTrip;
  /** 嵌在「我的路線」右欄時不顯示返回連結、不限寬 */
  embedded?: boolean;
}) {
  const { route, loading, error } = usePrivateRoute(routeId);
  // 路線還沒載入完成前不打判讀，避免 session 尚未重換時拿到 401
  const recon = useRouteRecon(route, trip, PRIVATE_BRIEFING_ENDPOINT);
  // 路線卡：手機往下捲過它後，頂部改顯示懸浮列（路線名＋回我的路線）
  const [routeHeaderEl, setRouteHeaderEl] = useState<HTMLDivElement | null>(null);

  const backLink = embedded ? null : (
    <Button asChild variant="ghost" size="sm" className="-ml-2 gap-1">
      <Link href="/routes/private">
        <ChevronLeft className="size-4" aria-hidden />
        我的路線
      </Link>
    </Button>
  );

  if (loading) return <RoutesLoading />;

  if (error || !route) {
    return (
      <div className="space-y-4">
        {backLink}
        <div className="mx-auto flex min-h-[40dvh] max-w-sm flex-col items-center justify-center gap-2 text-center">
          <p className="text-sm text-destructive">{error ?? "找不到路線"}</p>
          <p className="text-xs text-muted-foreground">路線可能已刪除，或不是你上傳的。</p>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("w-full min-w-0 space-y-5", !embedded && "mx-auto max-w-5xl")}>
      {/* 嵌在桌機右欄時懸浮列本來就不顯示（lg:hidden），不必掛 */}
      {!embedded && (
        <RouteStickyBar anchor={routeHeaderEl} route={route} status={recon.status} listHref="/routes/private" />
      )}
      {backLink}
      <RouteReconBody route={route} trip={trip} recon={recon} headerRef={setRouteHeaderEl} />
    </div>
  );
}
