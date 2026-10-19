"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RoutesLoading } from "@/components/routes/routes-loading";
import { RouteHeader } from "@/components/routes/route-header";
import { ReconView } from "@/components/routes/recon-view";
import { RideAhead } from "@/components/routes/ride-ahead";
import { TripSettings } from "@/components/trip/trip-settings";
import { usePrivateRoute } from "@/hooks/usePrivateRoutes";
import { useRouteCCTV } from "@/hooks/useRouteCCTV";
import { useRouteBriefing } from "@/hooks/useRouteBriefing";
import { buildRoutePolylineKm, routeTotalKm } from "@/lib/routes/recon-geo";
import { formatClock, type Activity } from "@/lib/routes/trip";

const PRIVATE_BRIEFING_ENDPOINT = "/api/routes/private/briefing";

/**
 * 私人路線詳情：與公開路線頁同一套偵察畫面（判定、示警、坡度、CCTV、途中模式、行程設定），
 * 只是路線來自使用者上傳的 GPX，判讀改打 /api/routes/private/briefing。
 */
export function PrivateRouteDetail({
  routeId,
  trip,
}: {
  routeId: string;
  /** 網址上的行程設定（出發時間 ISO、運動類型），未指定為 null */
  trip: { depart: string | null; activity: Activity | null };
}) {
  const { route, loading, error } = usePrivateRoute(routeId);
  // 途中模式的目前里程與套用時間；at 用來觸發定時重新判讀
  const [ahead, setAhead] = useState<{ km: number; at: number } | null>(null);
  const setAheadKm = useCallback((km: number | null) => setAhead(km != null ? { km, at: Date.now() } : null), []);

  const cctv = useRouteCCTV(route);
  const polyline = useMemo(() => (route ? buildRoutePolylineKm(route) : null), [route]);
  // 路線還沒載入完成前不打判讀，避免 session 尚未重換時拿到 401
  const briefing = useRouteBriefing(
    route?.id,
    trip,
    ahead?.km ?? null,
    ahead?.at ?? null,
    PRIVATE_BRIEFING_ENDPOINT
  );

  const backLink = (
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

  const suggestion = briefing.briefing?.departureSuggestion;
  return (
    <div className="mx-auto w-full min-w-0 max-w-5xl space-y-5">
      {backLink}
      <RouteHeader
        route={route}
        departureLabel={suggestion ? (suggestion.nowIsBest ? "現在" : formatClock(new Date(suggestion.from), new Date())) : null}
      />
      <ReconView
        route={route}
        cctvFeeds={cctv.feeds}
        cctvLoading={cctv.loading}
        cctvError={cctv.error}
        cctvOffline={cctv.offline}
        briefing={briefing}
        afterHero={
          <div className="space-y-3">
            <RideAhead
              routeId={route.id}
              polyline={polyline}
              totalKm={routeTotalKm(route)}
              fromKm={ahead?.km ?? null}
              onChange={setAheadKm}
            />
            {/* 途中模式的出發時間由目前位置反推，不提供出發時間設定（同公開路線頁） */}
            {briefing.briefing && ahead == null && (
              <TripSettings
                departure={briefing.briefing.departure}
                activity={briefing.briefing.activity}
                speedKmh={briefing.briefing.speedKmh}
                defaultActivity={briefing.briefing.defaultActivity}
                explicitActivity={trip.activity}
                explicitDeparture={trip.depart}
              />
            )}
          </div>
        }
      />
    </div>
  );
}
