"use client";

import { useState } from "react";
import { ExternalLink, Maximize2, VideoOff, X } from "lucide-react";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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
import { latestObserved, type RouteRadar, type RouteRadarState } from "@/hooks/useRouteRadar";
import type { RadarZoom, ViewInsets } from "@/lib/cwb/radar";
import {
  CCTV_FAR_KM,
  CctvFrame,
  CctvFullscreen,
  cctvTitle,
} from "./cctv-viewer";
import { RouteVerdictBar, VERDICT_LEVEL_STYLE } from "./route-verdict-bar";
import { RouteTrack } from "./route-track";
import {
  RadarControls,
  RadarLegend,
  RadarMap,
  radarTimeLabel,
  useRadarFramesLoaded,
  useRadarHere,
  useRadarPlayback,
} from "./radar-map";

type HeroView = "cctv" | "radar";

/** 桌機主視覺切到雷達時：上方一行判定約 15%、下方播放列約 35% */
const HERO_INSETS = { top: 0.15, bottom: 0.35 };
/** 沒有判定疊在上面的雷達（無鏡頭路線、全螢幕）：只有下方播放列 */
const PANEL_INSETS = { top: 0, bottom: 0.35 };
const SHEET_INSETS = { top: 0, bottom: 0.25 };
const PIP_INSETS = { top: 0, bottom: 0.2 };

/** 雷達相關的共用 props：資料、路線折線與目前里程 */
type RadarProps = {
  radar: RouteRadarState;
  polyline: RoutePolylineKm | null;
  positionKm: number;
};

/**
 * 雷達回放：地圖鋪滿容器，底部漸層上放目前位置回波、圖例與播放列。
 * actions 放在播放列最右邊（桌機的「影像｜雷達」切換、放大鈕）。
 */
function RadarPanel({
  radar,
  polyline,
  positionKm,
  insets,
  className,
  actions,
}: {
  radar: RouteRadar;
  polyline: RoutePolylineKm | null;
  positionKm: number;
  insets: ViewInsets;
  className?: string;
  actions?: React.ReactNode;
}) {
  const loaded = useRadarFramesLoaded(radar.frames);
  const playback = useRadarPlayback(radar.frames, loaded.size === radar.frames.length);
  const [zoom, setZoom] = useState<RadarZoom>("near");
  const frame = radar.frames[playback.index]!;
  const frameLoaded = loaded.has(frame.id);
  const here = useRadarHere(frame, polyline, positionKm);
  return (
    <div className={cn("relative overflow-hidden bg-[#0b1220]", className)}>
      <RadarMap
        radar={radar}
        frameIndex={playback.index}
        polyline={polyline}
        positionKm={positionKm}
        zoom={zoom}
        insets={insets}
        className="absolute inset-0 h-full w-full"
      />
      {!frameLoaded && (
        <p role="status" className="absolute inset-0 flex items-center justify-center gap-2 bg-[#0b1220]/70 text-sm text-white">
          <Spinner size="sm" dotClassName="bg-white" />
          雷達圖載入中
        </p>
      )}
      <div className="absolute inset-x-0 bottom-0 space-y-2 bg-gradient-to-t from-black/90 via-black/70 to-transparent px-3 pb-2 pt-8">
        <div className="flex items-end justify-between gap-3">
          {/* 預報與否看播放列的「預報」標籤 */}
          <p className="min-w-0 text-xs font-medium leading-snug text-white">{here}</p>
          <RadarLegend className="w-36 shrink-0 sm:w-56" />
        </div>
        <div className="flex items-center gap-1">
          <RadarControls
            frames={radar.frames}
            loaded={loaded}
            index={playback.index}
            playing={playback.playing}
            onToggle={playback.toggle}
            onSeek={playback.seek}
            zoom={zoom}
            onZoom={setZoom}
            className="min-w-0 flex-1"
          />
          {actions}
        </div>
      </div>
    </div>
  );
}

/** 全螢幕雷達：手機點子母畫面、桌機點放大鈕開啟；不疊判定，整張圖都看得到 */
function RadarSheet({
  open,
  onOpenChange,
  radar,
  polyline,
  positionKm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  radar: RouteRadar;
  polyline: RoutePolylineKm | null;
  positionKm: number;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          "grid h-[85vh] max-w-5xl grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden border-0 bg-[#0b1220] p-0 text-white",
          "max-lg:inset-0 max-lg:left-0 max-lg:top-0 max-lg:h-[100dvh] max-lg:max-w-none max-lg:translate-x-0 max-lg:translate-y-0 max-lg:rounded-none!",
          "max-lg:data-[state=open]:slide-in-from-left-0 max-lg:data-[state=open]:slide-in-from-top-0",
          "max-lg:data-[state=closed]:slide-out-to-left-0 max-lg:data-[state=closed]:slide-out-to-top-0"
        )}
      >
        <DialogHeader className="flex-row items-center justify-between gap-2 space-y-0 py-1 pl-4 text-left">
          <div className="min-w-0">
            <DialogTitle className="text-base">雷達回波</DialogTitle>
            <DialogDescription className="text-xs text-white/60">過去 1 小時實況，每 10 分鐘一張，加未來 1 小時預報</DialogDescription>
          </div>
          <DialogClose asChild>
            <button
              type="button"
              aria-label="關閉雷達"
              className="flex size-11 shrink-0 cursor-pointer items-center justify-center hover:bg-white/10"
            >
              <X className="size-5" aria-hidden />
            </button>
          </DialogClose>
        </DialogHeader>
        <RadarPanel
          radar={radar}
          polyline={polyline}
          positionKm={positionKm}
          insets={SHEET_INSETS}
          className="h-full pb-[env(safe-area-inset-bottom)]"
        />
      </DialogContent>
    </Dialog>
  );
}

/** 放大雷達（開全螢幕） */
function RadarExpandButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="全螢幕看雷達"
      className="flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-full text-white hover:bg-white/15"
    >
      <Maximize2 className="size-4" aria-hidden />
    </button>
  );
}

/**
 * 桌機（lg 以上）：「影像｜雷達」切換。雷達暫無時雷達鈕停用並說明。
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
    <div role="group" aria-label="主視覺" className="mr-1 hidden shrink-0 rounded-full bg-white/15 p-0.5 text-xs font-medium lg:flex">
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
 * 手機（lg 以下）：影像右下角的雷達子母畫面（最新一張），點了開全螢幕回放。
 * 雷達暫無時只顯示一行說明，不能點。
 */
function RadarPip({
  radar,
  polyline,
  positionKm,
  onOpen,
}: RadarProps & { onOpen: () => void }) {
  const data = radar.status === "ready" ? radar.data : null;
  const observed = data ? latestObserved(data.frames) : null;
  const here = useRadarHere(observed, polyline, positionKm);
  if (radar.status === "loading") return null;
  const corner = "absolute bottom-14 right-3 lg:hidden";
  if (!data) {
    return <p className={cn(corner, "rounded bg-black/70 px-2 py-1 text-[11px] text-white/80")}>雷達資料暫無</p>;
  }
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`放大雷達回波圖（${here ?? "載入中"}）`}
      className={cn(corner, "h-24 w-32 cursor-pointer overflow-hidden rounded-lg border-2 border-white/80 shadow-lg")}
    >
      <RadarMap radar={data} polyline={polyline} positionKm={positionKm} compact insets={PIP_INSETS} className="h-full w-full" />
      <span className="absolute inset-x-0 bottom-0 truncate bg-black/70 px-1.5 py-0.5 text-left text-[10px] text-white">
        {here ?? `雷達 ${radarTimeLabel(observed!.observedAt)}`}
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

/**
 * 影像上方的判定：一眼看到能不能走；影像只是佐證，判定仍以規則式結果為準。
 * compact：桌機主視覺切到雷達時縮成一行，讓出地圖。
 */
function VerdictOverlay({
  verdict,
  loading,
  headlinePending,
  compact = false,
}: {
  verdict: ReconVerdict;
  loading: boolean;
  headlinePending: boolean;
  compact?: boolean;
}) {
  const word = VERDICT_LEVEL_STYLE[verdict.level].word;
  const pill = (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full font-bold leading-none",
        compact ? "px-2.5 py-1 text-sm" : "px-3 py-1 text-lg",
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
  );
  if (compact) {
    return (
      <div role="status" aria-live="polite" className="absolute inset-x-0 top-0 flex items-center gap-2 bg-black/65 px-4 py-2 text-white">
        {pill}
        {!loading && !headlinePending && <p className="min-w-0 truncate text-sm font-medium">{verdict.headline}</p>}
      </div>
    );
  }
  return (
    <div
      role="status"
      aria-live="polite"
      className="absolute inset-x-0 top-0 bg-black/65 px-4 py-3 text-white"
    >
      <p>{pill}</p>
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

/** 有鏡頭：影像當背景，上疊判定，下方是鏡頭名與外連、放大；桌機可切到雷達回放 */
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
  onOpenRadar,
}: RadarProps & {
  marker: CctvMarker;
  verdict: ReconVerdict;
  verdictLoading: boolean;
  headlinePending: boolean;
  view: HeroView;
  onView: (v: HeroView) => void;
  onOpenRadar: () => void;
}) {
  const title = cctvTitle(marker);
  const isFar = Math.abs(marker.km - positionKm) > CCTV_FAR_KM;
  const radarData = radar.status === "ready" ? radar.data : null;
  // 雷達暫無時一律回到影像；切換鈕只在桌機出現，手機由子母畫面開全螢幕
  const showRadar = view === "radar" && radarData != null;
  const toggle =
    radar.status !== "loading" ? (
      <HeroViewToggle view={showRadar ? "radar" : "cctv"} onView={onView} radarReady={radarData != null} />
    ) : null;

  return (
    <Dialog>
      <div className="relative flex h-64 items-center justify-center overflow-hidden bg-black sm:h-80">
        {showRadar ? (
          <RadarPanel
            radar={radarData}
            polyline={polyline}
            positionKm={positionKm}
            insets={HERO_INSETS}
            className="absolute inset-0"
            actions={
              <>
                <RadarExpandButton onClick={onOpenRadar} />
                {toggle}
              </>
            }
          />
        ) : (
          <>
            <CctvFrame key={marker.id} marker={marker} large />
            <RadarPip radar={radar} polyline={polyline} positionKm={positionKm} onOpen={onOpenRadar} />
          </>
        )}
        <VerdictOverlay
          verdict={verdict}
          loading={verdictLoading}
          headlinePending={headlinePending}
          compact={showRadar}
        />
        <div
          className={cn(
            "absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 bg-black/65 pl-4 text-white",
            showRadar && "hidden"
          )}
        >
          <p className="min-w-0 truncate text-xs">
            {isFar && "最近一台："}
            {title}・{marker.km.toFixed(1)} km
          </p>
          <div className="flex shrink-0 items-center">
            {toggle}
            {marker.videoUrl && (
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
  headlinePending,
  cctvLoading,
  cctvError,
  cctvOffline,
  radar,
  polyline,
  positionKm,
  onOpenRadar,
}: RadarProps & {
  verdict: ReconVerdict;
  headlinePending: boolean;
  cctvLoading: boolean;
  cctvError: boolean;
  cctvOffline: boolean;
  onOpenRadar: () => void;
}) {
  const radarData = radar.status === "ready" ? radar.data : null;
  const cctvNote = cctvLoading ? null : cctvOffline ? "離線中，無法看即時影像" : cctvError ? "監視器載入失敗" : "沿途沒有監視器";
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
            {cctvNote}
          </>
        )}
      </p>
      {/* 沿途沒有影像但有雷達：判定在上、雷達回放在下，互不遮蓋 */}
      {radarData && !cctvLoading && (
        <RadarPanel
          radar={radarData}
          polyline={polyline}
          positionKm={positionKm}
          insets={PANEL_INSETS}
          className="mt-3 h-64 sm:h-80"
          actions={<RadarExpandButton onClick={onOpenRadar} />}
        />
      )}
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
  /** 雷達回波回放：手機點影像右下角子母畫面開全螢幕，桌機在底部列切換；只供顯示，不影響判定 */
  radar: RouteRadarState;
  /** 路線折線，雷達圖上畫路線與目前位置 */
  polyline: RoutePolylineKm | null;
}) {
  const [view, setView] = useState<HeroView>("cctv");
  const [radarOpen, setRadarOpen] = useState(false);
  const openRadar = () => setRadarOpen(true);
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
          onOpenRadar={openRadar}
        />
      ) : (
        <NoCctvStage
          verdict={verdict}
          radar={radar}
          polyline={polyline}
          positionKm={positionKm}
          headlinePending={headlinePending}
          cctvLoading={cctvLoading}
          cctvError={cctvError}
          cctvOffline={cctvOffline}
          onOpenRadar={openRadar}
        />
      )}
      {radar.status === "ready" && (
        <RadarSheet
          open={radarOpen}
          onOpenChange={setRadarOpen}
          radar={radar.data}
          polyline={polyline}
          positionKm={positionKm}
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
