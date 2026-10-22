"use client";

import { useState } from "react";
import { ExternalLink, Maximize2, Video, VideoOff, X } from "lucide-react";
import { Dialog, DialogTrigger } from "@/components/ui/dialog";
import Spinner from "@/components/ui/Spinner";
import { UnknownReasons } from "@/components/verdict/unknown-reasons";
import {
  HAZARD_ROW_GRID,
  HazardRowContent,
} from "@/components/verdict/hazard-row";
import { cn } from "@/lib/utils";
import type {
  CctvMarker,
  ReconVerdict,
  VerdictLevel,
} from "@/lib/routes/recon-geo";
import type { RoutePolylineKm } from "@/lib/routes/recon-geo";
import type { TrackZone } from "@/lib/routes/route-track";
import type { RouteRadarState } from "@/hooks/useRouteRadar";
import {
  CCTV_FAR_KM,
  CctvFrame,
  CctvFullscreen,
  cctvTitle,
} from "./cctv-viewer";
import { RouteVerdictBar, VERDICT_LEVEL_STYLE } from "./route-verdict-bar";
import { RouteTrack } from "./route-track";
import { RadarLegend, RadarMap, radarTimeLabel, useRadarHere } from "./radar-map";

type HeroView = "cctv" | "radar";

/** 主視覺上方的判定約佔 35%、下方圖例與說明列約 25%；子母畫面只有底部一行字 */
const HERO_INSETS = { top: 0.35, bottom: 0.25 };
const PIP_INSETS = { top: 0, bottom: 0.2 };

/** 雷達相關的共用 props：資料、路線折線與目前里程 */
type RadarProps = {
  radar: RouteRadarState;
  polyline: RoutePolylineKm | null;
  positionKm: number;
};

/** 主視覺切到雷達時的底部說明：觀測時間、目前位置回波、聲明不影響判定 */
function radarCaption(observedAt: string, here: string | null): string {
  return [`雷達回波 ${radarTimeLabel(observedAt)}`, here, "不影響判定"].filter(Boolean).join("・");
}

/** 雷達圖鋪滿主視覺，底部留圖例 */
function RadarStage({ radar, polyline, positionKm }: RadarProps) {
  if (radar.status !== "ready") return null;
  return (
    <>
      <RadarMap
        radar={radar.data}
        polyline={polyline}
        positionKm={positionKm}
        insets={HERO_INSETS}
        className="absolute inset-0 h-full w-full"
      />
      {/* 手機右下角留給「影像」鈕 */}
      <RadarLegend className="absolute bottom-14 left-4 right-28 lg:right-4" />
    </>
  );
}

/**
 * 桌機（lg 以上）：底部列的「影像｜雷達」切換。雷達暫無時雷達鈕停用並說明。
 */
function HeroViewToggle({
  view,
  onView,
  radarReady,
}: {
  view: HeroView;
  onView: (v: HeroView) => void;
  radarReady: boolean;
}) {
  return (
    <div role="group" aria-label="主視覺" className="mr-1 hidden rounded-full bg-white/15 p-0.5 text-xs font-medium lg:flex">
      {(
        [
          ["cctv", "影像"],
          ["radar", radarReady ? "雷達" : "雷達資料暫無"],
        ] as const
      ).map(([v, label]) => (
        <button
          key={v}
          type="button"
          aria-pressed={view === v}
          disabled={v === "radar" && !radarReady}
          onClick={() => onView(v)}
          className={cn(
            "cursor-pointer rounded-full px-3 py-1.5 disabled:cursor-not-allowed disabled:text-white/40",
            view === v ? "bg-white text-black" : "text-white/80 hover:text-white"
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

/**
 * 手機（lg 以下）：影像右下角的雷達子母畫面，點了與影像交換；
 * 切到雷達後只留「影像」小鈕，不擋地圖。雷達暫無時只顯示一行說明，不能點。
 */
function RadarPip({
  view,
  onView,
  here,
  radar,
  polyline,
  positionKm,
}: RadarProps & { view: HeroView; onView: (v: HeroView) => void; here: string | null }) {
  if (radar.status === "loading") return null;
  const corner = "absolute bottom-14 right-3 lg:hidden";
  if (radar.status === "unavailable") {
    return <p className={cn(corner, "rounded bg-black/70 px-2 py-1 text-[11px] text-white/80")}>雷達資料暫無</p>;
  }
  if (view === "radar") {
    return (
      <button
        type="button"
        onClick={() => onView("cctv")}
        className={cn(corner, "flex h-9 cursor-pointer items-center gap-1.5 rounded-full bg-black/75 px-3 text-xs font-medium text-white")}
      >
        <Video className="size-3.5" aria-hidden />
        影像
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={() => onView("radar")}
      aria-label={`放大雷達回波圖（${here ?? "載入中"}）`}
      className={cn(corner, "h-24 w-32 cursor-pointer overflow-hidden rounded-lg border-2 border-white/80 shadow-lg")}
    >
      <RadarMap
        radar={radar.data}
        polyline={polyline}
        positionKm={positionKm}
        compact
        insets={PIP_INSETS}
        className="h-full w-full"
      />
      <span className="absolute inset-x-0 bottom-0 truncate bg-black/70 px-1.5 py-0.5 text-left text-[10px] text-white">
        {here ?? `雷達 ${radarTimeLabel(radar.data.observedAt)}`}
      </span>
    </button>
  );
}

/** 疊在影像上的判定膠囊：影像亮暗不定，一律用實心底色 */
const VERDICT_PILL: Record<VerdictLevel, string> = {
  risky: "bg-destructive text-destructive-foreground",
  caution: "bg-warning text-warning-foreground",
  clear: "bg-success text-background",
  unknown: "bg-muted text-muted-foreground",
};

/** 影像上方的判定：一眼看到能不能走；影像只是佐證，判定仍以規則式結果為準 */
function VerdictOverlay({
  verdict,
  loading,
  headlinePending,
}: {
  verdict: ReconVerdict;
  loading: boolean;
  headlinePending: boolean;
}) {
  const word = VERDICT_LEVEL_STYLE[verdict.level].word;
  return (
    <div
      role="status"
      aria-live="polite"
      className="absolute inset-x-0 top-0 bg-black/65 px-4 py-3 text-white"
    >
      <p>
        <span
          className={cn(
            "inline-flex items-center rounded-full px-3 py-1 text-lg font-bold leading-none",
            VERDICT_PILL[loading ? "unknown" : verdict.level],
          )}
        >
          {loading ? (
            "判讀中"
          ) : verdict.level === "unknown" ? (
            <UnknownReasons reasons={verdict.reasons}>{word}</UnknownReasons>
          ) : (
            word
          )}
        </span>
      </p>
      {!loading &&
        (headlinePending ? (
          <HeadlineSkeleton className="mt-2 h-4 bg-white/25" />
        ) : (
          <p className="mt-1.5 text-sm font-medium leading-snug">
            {verdict.headline}
          </p>
        ))}
      {!loading && verdict.note && (
        <p className="mt-0.5 text-xs text-white/75">{verdict.note}</p>
      )}
    </div>
  );
}

/** 判定句等 AI 摘要時的骨架：只佔句子的位置，判定詞照常顯示 */
export function HeadlineSkeleton({ className }: { className?: string }) {
  return (
    <span
      role="status"
      className={cn("block w-3/4 max-w-xs animate-pulse rounded", className)}
    >
      <span className="sr-only">判定說明載入中</span>
    </span>
  );
}

/** 有鏡頭：影像當背景，上疊判定，下方是鏡頭名與外連、放大 */
function CctvStage({
  marker,
  positionKm,
  verdict,
  verdictLoading,
  headlinePending,
  radar,
  polyline,
  view,
  onView,
}: RadarProps & {
  marker: CctvMarker;
  verdict: ReconVerdict;
  verdictLoading: boolean;
  headlinePending: boolean;
  view: HeroView;
  onView: (v: HeroView) => void;
}) {
  const title = cctvTitle(marker);
  const isFar = Math.abs(marker.km - positionKm) > CCTV_FAR_KM;
  const radarData = radar.status === "ready" ? radar.data : null;
  const here = useRadarHere(radarData, polyline, positionKm);
  // 雷達暫無時一律回到影像
  const showRadar = view === "radar" && radarData != null;

  return (
    <Dialog>
      <div className="relative flex h-64 items-center justify-center overflow-hidden bg-black sm:h-80">
        {showRadar ? (
          <RadarStage radar={radar} polyline={polyline} positionKm={positionKm} />
        ) : (
          <CctvFrame key={marker.id} marker={marker} large />
        )}
        <RadarPip
          view={showRadar ? "radar" : "cctv"}
          onView={onView}
          here={here}
          radar={radar}
          polyline={polyline}
          positionKm={positionKm}
        />
        <VerdictOverlay
          verdict={verdict}
          loading={verdictLoading}
          headlinePending={headlinePending}
        />
        <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 bg-black/65 pl-4 text-white">
          <p className="min-w-0 truncate text-xs">
            {showRadar ? (
              radarCaption(radarData.observedAt, here)
            ) : (
              <>
                {isFar && "最近一台："}
                {title}・{marker.km.toFixed(1)} km
              </>
            )}
          </p>
          <div className="flex shrink-0 items-center">
            {radar.status !== "loading" && (
              <HeroViewToggle view={showRadar ? "radar" : "cctv"} onView={onView} radarReady={radarData != null} />
            )}
            {!showRadar && marker.videoUrl && (
              <a
                href={marker.videoUrl}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="在新分頁開啟直播"
                className="flex size-11 items-center justify-center hover:bg-white/10"
              >
                <ExternalLink className="size-4" aria-hidden />
              </a>
            )}
            <DialogTrigger asChild>
              <button
                type="button"
                hidden={showRadar}
                aria-label="放大監視器畫面"
                className="flex size-11 cursor-pointer items-center justify-center hover:bg-white/10"
              >
                <Maximize2 className="size-4" aria-hidden />
              </button>
            </DialogTrigger>
          </div>
        </div>
      </div>
      <CctvFullscreen marker={marker} title={title} />
    </Dialog>
  );
}

/** 沒有鏡頭（載入中、載入失敗、沿途沒有、離線）：主視覺改成判定本身，不留空黑框 */
function NoCctvStage({
  verdict,
  verdictLoading,
  headlinePending,
  cctvLoading,
  cctvError,
  cctvOffline,
  radar,
  polyline,
  positionKm,
}: RadarProps & {
  verdict: ReconVerdict;
  verdictLoading: boolean;
  headlinePending: boolean;
  cctvLoading: boolean;
  cctvError: boolean;
  cctvOffline: boolean;
}) {
  const radarData = radar.status === "ready" ? radar.data : null;
  const here = useRadarHere(radarData, polyline, positionKm);
  // 沿途沒有可看的影像但有雷達：雷達圖當主視覺，判定照樣疊在最上層
  if (radarData && !cctvLoading) {
    return (
      <div className="relative h-64 overflow-hidden bg-black sm:h-80">
        <RadarStage radar={radar} polyline={polyline} positionKm={positionKm} />
        <VerdictOverlay verdict={verdict} loading={verdictLoading} headlinePending={headlinePending} />
        <p className="absolute inset-x-0 bottom-0 flex h-11 items-center gap-2 truncate bg-black/65 px-4 text-xs text-white">
          <VideoOff className="size-4 shrink-0" aria-hidden />
          <span className="truncate">
            {cctvError ? "監視器載入失敗" : "沿途沒有監視器"}・{radarCaption(radarData.observedAt, here)}
          </span>
        </p>
      </div>
    );
  }
  return (
    <div>
      <RouteVerdictBar verdict={verdict} headlinePending={headlinePending} />
      <p
        className="flex items-center gap-2 px-4 pt-3 text-sm text-muted-foreground"
        role={cctvLoading ? "status" : undefined}
      >
        {cctvLoading ? (
          <>
            <Spinner size="sm" dotClassName="bg-muted-foreground" />
            正在找沿途監視器
          </>
        ) : (
          <>
            <VideoOff className="size-4" aria-hidden />
            {cctvOffline
              ? "離線中，無法看即時影像"
              : cctvError
                ? "監視器載入失敗"
                : "沿途沒有監視器"}
          </>
        )}
      </p>
    </div>
  );
}

/** 停到示警路段後的說明：這段的示警一次列出 */
function ZoneCallout({
  zone,
  etaOf,
  onClose,
}: {
  zone: TrackZone;
  etaOf?: (km: number) => string;
  onClose: () => void;
}) {
  return (
    <div className="mx-3 mb-3 rounded-lg border border-border bg-muted/40">
      <div className="flex items-center justify-between pl-3">
        <p className="text-sm font-semibold text-foreground">
          {zone.startKm.toFixed(1)}–{zone.endKm.toFixed(1)} km 示警{" "}
          {zone.hazards.length} 項
        </p>
        <button
          type="button"
          onClick={onClose}
          aria-label="關閉示警說明"
          className="flex size-11 cursor-pointer items-center justify-center text-muted-foreground hover:text-foreground"
        >
          <X className="size-4" aria-hidden />
        </button>
      </div>
      <ul className="divide-y divide-border/60 border-t border-border/60 px-1">
        {zone.hazards.map((h) => (
          <li key={h.id} className={HAZARD_ROW_GRID}>
            <HazardRowContent hazard={h} eta={etaOf?.(h.startKm)} />
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * 路線頁主視覺（B2）：判定疊在即時影像上，正下方是里程軌道。
 * 戶外使用者多半只瞄一眼：先看「能不能走」，再看「現在路上長怎樣」；
 * 拇指在影像下方滑軌道或按 ‹ › 換鏡頭，不用捲動頁面。
 */
export function ReconHero({
  verdict,
  verdictLoading,
  headlinePending = false,
  markers,
  activeMarker,
  cctvLoading,
  cctvError,
  cctvOffline,
  positionKm,
  totalKm,
  zones,
  activeZone,
  etaOf,
  onMove,
  onSelectMarker,
  onSelectZone,
  onCloseZone,
  radar,
  polyline,
}: {
  verdict: ReconVerdict;
  /** 判讀尚未回來 */
  verdictLoading: boolean;
  /** 判定句還在等 AI 摘要：句子位置顯示骨架 */
  headlinePending?: boolean;
  markers: CctvMarker[];
  activeMarker: CctvMarker | null;
  cctvLoading: boolean;
  cctvError: boolean;
  /** 離線：即時影像播不了，主視覺改顯示判定，軌道仍標出鏡頭位置 */
  cctvOffline: boolean;
  positionKm: number;
  totalKm: number;
  /** 路況色段（上層以 trackZones 算好，與高程圖、示警列表共用停點） */
  zones: TrackZone[];
  /** 展開說明中的示警路段 */
  activeZone: TrackZone | null;
  etaOf?: (km: number) => string;
  onMove: (km: number) => void;
  onSelectMarker: (marker: CctvMarker) => void;
  onSelectZone: (zone: TrackZone) => void;
  onCloseZone: () => void;
  /** 路線附近的雷達回波：手機在影像右下角子母畫面，桌機在底部列切換；只供顯示，不影響判定 */
  radar: RouteRadarState;
  /** 路線折線，雷達圖上畫路線與目前位置 */
  polyline: RoutePolylineKm | null;
}) {
  const [view, setView] = useState<HeroView>("cctv");
  return (
    <section
      aria-label="沿線影像與判定"
      className="overflow-hidden rounded-2xl border border-border bg-card"
    >
      {activeMarker && !cctvOffline ? (
        <CctvStage
          marker={activeMarker}
          positionKm={positionKm}
          verdict={verdict}
          verdictLoading={verdictLoading}
          headlinePending={headlinePending}
          radar={radar}
          polyline={polyline}
          view={view}
          onView={setView}
        />
      ) : (
        <NoCctvStage
          verdict={verdict}
          verdictLoading={verdictLoading}
          radar={radar}
          polyline={polyline}
          positionKm={positionKm}
          headlinePending={headlinePending}
          cctvLoading={cctvLoading}
          cctvError={cctvError}
          cctvOffline={cctvOffline}
        />
      )}
      <RouteTrack
        totalKm={totalKm}
        positionKm={positionKm}
        markers={markers}
        activeMarker={activeMarker}
        zones={zones}
        activeZone={activeZone}
        onMove={onMove}
        onSelectMarker={onSelectMarker}
        onSelectZone={onSelectZone}
      />
      {activeZone && (
        <ZoneCallout zone={activeZone} etaOf={etaOf} onClose={onCloseZone} />
      )}
    </section>
  );
}
