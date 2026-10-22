"use client";

import type { Ref } from "react";
import type { Route } from "@/lib/routes/route-data";
import { RouteHeader } from "@/components/routes/route-header";
import { ReconView } from "@/components/routes/recon-view";
import { RideAhead } from "@/components/routes/ride-ahead";
import { TripSettings } from "@/components/trip/trip-settings";
import type { RouteRecon } from "@/hooks/useRouteRecon";
import { routeTotalKm } from "@/lib/routes/recon-geo";
import type { Activity } from "@/lib/routes/trip";
import { departureLabelOf } from "@/lib/dashboard/advice";

/**
 * 路線詳情本體：路線卡＋偵察畫面（判定、示警、坡度、CCTV、途中模式、行程設定）。
 * 公開路線頁與私人路線詳情共用；外層容器（動畫、寬度、返回連結）由各頁自己包。
 */
export function RouteReconBody({
  route,
  trip,
  recon,
  headerRef,
}: {
  route: Route;
  /** 網址上的行程設定（出發時間 ISO、運動類型），未指定為 null */
  trip: { depart: string | null; activity: Activity | null };
  recon: RouteRecon;
  /** 路線卡外層；手機往下捲過它後顯示懸浮路線列 */
  headerRef?: Ref<HTMLDivElement>;
}) {
  const { briefing, cctv, polyline, aheadKm, setAheadKm } = recon;
  const suggestion = briefing.briefing?.departureSuggestion;

  return (
    <>
      <div ref={headerRef}>
        <RouteHeader
          route={route}
          departureLabel={departureLabelOf(suggestion ?? null, new Date())}
        />
      </div>
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
              fromKm={aheadKm}
              onChange={setAheadKm}
            />
            {/* 途中模式的出發時間是由目前位置反推的，不提供出發時間設定，避免與「現在」矛盾 */}
            {briefing.briefing && aheadKm == null && (
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
    </>
  );
}
