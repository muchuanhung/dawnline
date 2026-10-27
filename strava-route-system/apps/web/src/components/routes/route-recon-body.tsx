"use client";

import { useState, type Ref } from "react";
import type { Route } from "@/lib/routes/route-data";
import { RouteHeader } from "@/components/routes/route-header";
import { ReconView } from "@/components/routes/recon-view";
import { RideAhead, needsPlacement } from "@/components/routes/ride-ahead";
import { usePositionOnRoute } from "@/hooks/usePositionOnRoute";
import { TripSettings } from "@/components/trip/trip-settings";
import { SpeedSheet } from "@/components/trip/speed-sheet";
import type { RouteRecon } from "@/hooks/useRouteRecon";
import { routeTotalKm } from "@/lib/routes/recon-geo";
import { formatDuration, routeEstimate, speedLevelLabel, type PageTrip } from "@/lib/routes/trip";
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
  trip: PageTrip;
  recon: RouteRecon;
  /** 路線卡外層；手機往下捲過它後顯示懸浮路線列 */
  headerRef?: Ref<HTMLDivElement>;
}) {
  const { briefing, cctv, radar, polyline, aheadKm, setAheadKm } = recon;
  const suggestion = briefing.briefing?.departureSuggestion;
  // 定位狀態放在這一層：判讀範圍卡顯示狀態，定位失敗時軌道也要用 choose 讓使用者放置位置
  const position = usePositionOnRoute({ routeId: route.id, polyline, riding: aheadKm != null, onKm: setAheadKm });
  const placing = needsPlacement(position.state);
  // 均速設定面板：路線卡的速度按鈕與行程設定的「調整速度」共用
  const [speedOpen, setSpeedOpen] = useState(false);
  // 與伺服器 briefRoute 相同的解析：網址運動類型 → 依路線類型；cookie 自訂均速 → 預設
  const { activity, speedKmh, flatHours, climbHours } = routeEstimate(route, trip);
  const totalKm = routeTotalKm(route);
  const climbMinutes = Math.round(climbHours * 60);

  return (
    <>
      <div ref={headerRef}>
        <RouteHeader
          route={route}
          departureLabel={departureLabelOf(suggestion ?? null, new Date())}
          estimate={{
            totalLabel: formatDuration(flatHours + climbHours),
            climbLabel: climbMinutes > 0 ? formatDuration(climbHours) : null,
            speedLabel: `${speedLevelLabel(activity, speedKmh)} ${speedKmh} km/h`,
            onEdit: () => setSpeedOpen(true),
          }}
        />
      </div>
      <ReconView
        route={route}
        cctvFeeds={cctv.feeds}
        cctvLoading={cctv.loading}
        cctvError={cctv.error}
        cctvOffline={cctv.offline}
        radar={radar}
        briefing={briefing}
        onPlaceYou={placing || aheadKm != null ? position.choose : undefined}
        placing={placing}
        afterHero={
          <RideAhead position={position} totalKm={totalKm} fromKm={aheadKm} onChange={setAheadKm}>
            {/* 途中模式的出發時間由目前位置反推，TripSettings 改為唯讀顯示，避免與「現在」矛盾 */}
            {briefing.briefing && (
              <TripSettings
                departure={briefing.briefing.departure}
                activity={briefing.briefing.activity}
                speedKmh={briefing.briefing.speedKmh}
                defaultActivity={briefing.briefing.defaultActivity}
                explicitActivity={trip.activity}
                explicitDeparture={trip.depart}
                fromKm={briefing.briefing.fromKm}
                onEditSpeed={() => setSpeedOpen(true)}
              />
            )}
          </RideAhead>
        }
      />
      <SpeedSheet
        open={speedOpen}
        onOpenChange={setSpeedOpen}
        activity={activity}
        speedKmh={speedKmh}
        profile={route.elevationProfile}
        totalKm={totalKm}
        elevationGainM={route.elevationGain}
      />
    </>
  );
}
