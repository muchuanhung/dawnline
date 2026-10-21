"use client";

import { useCallback, useEffect, useMemo, type ReactNode } from "react";
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
  type Hazard,
  type RouteStage,
} from "@/lib/routes/recon-geo";
import { useReconPosition } from "@/hooks/useReconPosition";
import {
  currentStop,
  dedupeMarkers,
  nearestMarkerStop,
  stopForHazard,
  trackStops,
  trackZones,
} from "@/lib/routes/route-track";
import { etaLabel, paceFor } from "@/lib/routes/trip";
import { roadEventsOf, verdictOf, type RouteBriefingState } from "@/hooks/useRouteBriefing";
import { summaryApplies, type BriefingSummary } from "@/lib/dashboard/briefing-summary";
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
  /** AI 一句話摘要；只在依據的判定與目前判定相同時取代主視覺的 headline */
  summary?: BriefingSummary | null;
  /** 緊接在主視覺下方的行程控制（途中定位、出發時間與運動類型），讓判定與影像留在第一眼 */
  afterHero?: ReactNode;
}

/**
 * 路線偵察畫面：
 * 1 主視覺（判定疊在即時影像上＋里程軌道）→ 行程控制 → 2 沿途示警 → 3 高程圖（游標處天氣）
 * 軌道、示警列表與高程圖共用同一個游標位置與同一組停點（鏡頭＋示警路段）：
 * 拖高程圖、點示警和拖軌道一樣只停在停點上，三處永遠指向同一台鏡頭或同一段示警
 */
export function ReconView({
  route,
  cctvFeeds: cctvFeedsProp,
  cctvLoading = false,
  cctvError = false,
  cctvOffline = false,
  briefing,
  summary = null,
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
  // 判定等級、顏色與 note 不變，只換措辭；快照過期或判讀重抓後 headline 不同就退回規則句
  const heroVerdict = summaryApplies(summary, verdict) ? { ...verdict, headline: summary.text } : verdict;
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

  const totalKm = routeTotalKm(route);
  // 判讀未回來時軌道不上安全色；過期快照的路段一律不上安全色（未判定 ≠ 安全），示警路段照舊標出
  const zoneStages = trip ? stages : NO_STAGES;
  const eventsComplete = trip ? trip.eventsFailed !== null && trip.eventsFailed.length === 0 && !snapshot?.expired : false;
  // 途中模式的目前里程：之前的路段不上色，游標也移到這裡
  const fromKm = trip?.fromKm ?? null;
  const zones = useMemo(
    () => trackZones(totalKm, verdictHazards, zoneStages, { eventsComplete, fromKm }),
    [totalKm, verdictHazards, zoneStages, eventsComplete, fromKm]
  );
  const stops = useMemo(() => trackStops(cctvMarkers, zones), [cctvMarkers, zones]);

  const { positionKm, moveTo, selectMarker, selectZone, selectStop, closeZone, activeMarker, activeZone } =
    useReconPosition(route.id, cctvMarkers, initialMarker, zones);
  const stopHere = currentStop(activeZone, activeMarker, positionKm);

  /** 點示警：跳到它所屬的示警路段（與軌道停點一致）；途中已走過的找不到路段時才直接移到該處 */
  const jumpToHazard = useCallback(
    (hazard: Hazard) => {
      const stop = stopForHazard(stops, hazard.id);
      if (stop) selectStop(stop);
      else moveTo(hazard.startKm);
    },
    [stops, selectStop, moveTo]
  );

  /** 點不影響判定的沿線路況：不是停點，跳到最近的鏡頭看附近實況；沿途沒有鏡頭時才直接移到該處 */
  const jumpNearKm = useCallback(
    (km: number) => {
      const stop = nearestMarkerStop(stops, km);
      if (stop) selectStop(stop);
      else moveTo(km);
    },
    [stops, selectStop, moveTo]
  );

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
        verdict={heroVerdict}
        verdictLoading={briefing.loading && !briefing.briefing}
        markers={cctvMarkers}
        activeMarker={activeMarker}
        cctvLoading={cctvLoading}
        cctvError={cctvError}
        cctvOffline={offline}
        positionKm={positionKm}
        totalKm={totalKm}
        zones={zones}
        activeZone={activeZone}
        etaOf={etaOf}
        onMove={moveTo}
        onSelectMarker={selectMarker}
        onSelectZone={selectZone}
        onCloseZone={closeZone}
      />

      {afterHero}

      <HazardList
        hazards={verdictHazards}
        roadEvents={roadEvents}
        positionKm={positionKm}
        activeZone={activeZone}
        onJump={jumpNearKm}
        onSelectHazard={jumpToHazard}
        etaOf={etaOf}
      />

      <ElevationScrubber
        data={chartData}
        hazards={verdictHazards}
        positionKm={positionKm}
        totalKm={totalKm}
        stops={stops}
        currentStop={stopHere}
        onSelectStop={selectStop}
        elevation={currentElevation}
        peakElevation={peakElevation}
        stage={currentStage}
        onScrub={moveTo}
      />
    </div>
  );
}
