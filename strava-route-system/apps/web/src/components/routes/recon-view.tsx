"use client";

import { useEffect, useMemo, type ReactNode } from "react";
import type { CCTVFeed, Route } from "@/lib/routes/route-data";
import {
  buildRoutePolylineKm,
  buildCctvMarkers,
  pickInitialMarker,
  deriveStages,
  nearestByKm,
  routeTotalKm,
  stageAtKm,
  type ChartDataPoint,
  type RouteStage,
} from "@/lib/routes/recon-geo";
import { useReconPosition } from "@/hooks/useReconPosition";
import { dedupeMarkers } from "@/lib/routes/route-track";
import { etaLabel, paceFor } from "@/lib/routes/trip";
import { roadEventsOf, verdictOf, type RouteBriefingState } from "@/hooks/useRouteBriefing";
import { HazardList } from "./recon/hazard-list";
import { ElevationScrubber } from "./recon/elevation-scrubber";
import { ReconHero } from "./recon/recon-hero";
import { OfflineNotice } from "./recon/offline-notice";

export type { RouteStage, CctvMarker } from "@/lib/routes/recon-geo";

/** 判讀未回來時軌道不上安全色（固定參照，避免每次 render 重算色段） */
const NO_STAGES: RouteStage[] = [];

interface ReconViewProps {
  route: Route;
  /** 來自 useRouteCCTV 的即時清單；優先於 route.cctvFeeds */
  cctvFeeds?: CCTVFeed[];
  cctvLoading?: boolean;
  /** CCTV 抓取失敗，用來區分「載入失敗」與「沿途無監視器」 */
  cctvError?: boolean;
  /** CCTV 清單來自離線快照或網路失敗 */
  cctvOffline?: boolean;
  /** 伺服器端判讀（判定、示警、合併天氣的路段）；前端不自行判定 */
  briefing: RouteBriefingState;
  /** 緊接在主視覺下方的行程控制（途中定位、出發時間與運動類型），讓判定與影像留在第一眼 */
  afterHero?: ReactNode;
}

/**
 * 路線偵察畫面：
 * 1 主視覺（判定疊在即時影像上＋里程軌道）→ 行程控制 → 2 沿途示警 → 3 高程圖（游標處天氣）
 * 軌道與高程圖共用同一個游標位置
 */
export function ReconView({
  route,
  cctvFeeds: cctvFeedsProp,
  cctvLoading = false,
  cctvError = false,
  cctvOffline = false,
  briefing,
  afterHero,
}: ReconViewProps) {
  const routePolyline = useMemo(() => buildRoutePolylineKm(route), [route]);

  const verdictHazards = useMemo(() => briefing.briefing?.hazards ?? [], [briefing.briefing]);
  // 鏡頭精簡：一般路段 3 km 內只留一台能播放的，示警附近的鏡頭另外保留
  const cctvMarkers = useMemo(
    () =>
      dedupeMarkers(buildCctvMarkers(route, cctvFeedsProp ?? route.cctvFeeds ?? [], routePolyline), verdictHazards),
    [route, cctvFeedsProp, routePolyline, verdictHazards]
  );
  const initialMarker = useMemo(
    () => pickInitialMarker(cctvMarkers, routePolyline),
    [cctvMarkers, routePolyline]
  );

  // 高程圖游標處天氣用伺服器合併後的路段；判讀未回來前沿用原路段（hasWeather 皆為 false）
  const segments = briefing.briefing?.segments;
  const stages = useMemo(() => deriveStages(segments ? { ...route, segments } : route), [route, segments]);
  const verdict = verdictOf(briefing);
  const roadEvents = roadEventsOf(briefing);
  const trip = briefing.briefing;
  const snapshot = briefing.snapshot;
  // 判讀是快照代表目前收不到訊號，即時影像也播不了
  const offline = cctvOffline || snapshot != null;
  const etaOf = useMemo(() => {
    if (!trip) return undefined;
    const now = new Date();
    const pace = paceFor(trip.activity, trip.elevationProfile);
    return (km: number) => etaLabel(km, trip.departure, pace, now);
  }, [trip]);

  const chartData = useMemo<ChartDataPoint[]>(
    () => (route.elevationProfile ?? []).map(([km, elevation]) => ({ km, elevation })),
    [route.elevationProfile]
  );
  const peakElevation = useMemo(
    () => (chartData.length > 0 ? Math.max(...chartData.map((d) => d.elevation)) : 0),
    [chartData]
  );

  const { positionKm, moveTo, selectMarker, activeMarker } = useReconPosition(route.id, cctvMarkers, initialMarker);

  // 途中模式：高程圖游標移到目前里程
  const fromKm = briefing.briefing?.fromKm ?? null;
  useEffect(() => {
    if (fromKm != null) moveTo(fromKm);
  }, [fromKm, moveTo]);

  const currentStage = useMemo(() => stageAtKm(stages, positionKm), [stages, positionKm]);
  const currentElevation = useMemo(
    () => nearestByKm(chartData, positionKm)?.elevation ?? 0,
    [chartData, positionKm]
  );

  return (
    <div className="w-full min-w-0 max-w-full space-y-6">
      {snapshot && <OfflineNotice snapshot={snapshot} />}
      <ReconHero
        verdict={verdict}
        verdictLoading={briefing.loading && !briefing.briefing}
        markers={cctvMarkers}
        activeMarker={activeMarker}
        cctvLoading={cctvLoading}
        cctvError={cctvError}
        cctvOffline={offline}
        positionKm={positionKm}
        totalKm={routeTotalKm(route)}
        hazards={verdictHazards}
        stages={trip ? stages : NO_STAGES}
        // 過期快照的路段一律不上安全色（未判定 ≠ 安全）；示警路段照舊標出
        eventsComplete={
          trip ? trip.eventsFailed !== null && trip.eventsFailed.length === 0 && !snapshot?.expired : false
        }
        fromKm={trip?.fromKm ?? null}
        etaOf={etaOf}
        onMove={moveTo}
        onSelectMarker={selectMarker}
      />

      {afterHero}

      <HazardList
        hazards={verdictHazards}
        roadEvents={roadEvents}
        positionKm={positionKm}
        onJump={moveTo}
        etaOf={etaOf}
      />

      <ElevationScrubber
        data={chartData}
        hazards={verdictHazards}
        positionKm={positionKm}
        totalKm={routeTotalKm(route)}
        elevation={currentElevation}
        peakElevation={peakElevation}
        stage={currentStage}
        onScrub={moveTo}
      />
    </div>
  );
}
