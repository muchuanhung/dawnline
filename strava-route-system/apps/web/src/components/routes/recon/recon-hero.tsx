"use client";

import { ExternalLink, Maximize2, VideoOff, X } from "lucide-react";
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
import type { TrackZone } from "@/lib/routes/route-track";
import {
  CCTV_FAR_KM,
  CctvFrame,
  CctvFullscreen,
  cctvTitle,
} from "./cctv-viewer";
import { RouteVerdictBar, VERDICT_LEVEL_STYLE } from "./route-verdict-bar";
import { RouteTrack } from "./route-track";

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
}: {
  verdict: ReconVerdict;
  loading: boolean;
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
      {!loading && (
        <p className="mt-1.5 text-sm font-medium leading-snug">
          {verdict.headline}
        </p>
      )}
      {!loading && verdict.note && (
        <p className="mt-0.5 text-xs text-white/75">{verdict.note}</p>
      )}
    </div>
  );
}

/** 有鏡頭：影像當背景，上疊判定，下方是鏡頭名與外連、放大 */
function CctvStage({
  marker,
  positionKm,
  verdict,
  verdictLoading,
}: {
  marker: CctvMarker;
  positionKm: number;
  verdict: ReconVerdict;
  verdictLoading: boolean;
}) {
  const title = cctvTitle(marker);
  const isFar = Math.abs(marker.km - positionKm) > CCTV_FAR_KM;

  return (
    <Dialog>
      <div className="relative flex h-64 items-center justify-center overflow-hidden bg-black sm:h-80">
        <CctvFrame key={marker.id} marker={marker} large />
        <VerdictOverlay verdict={verdict} loading={verdictLoading} />
        <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 bg-black/65 pl-4 text-white">
          <p className="min-w-0 truncate text-xs">
            {isFar && "最近一台："}
            {title}・{marker.km.toFixed(1)} km
          </p>
          <div className="flex shrink-0">
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
  cctvLoading,
  cctvError,
  cctvOffline,
}: {
  verdict: ReconVerdict;
  cctvLoading: boolean;
  cctvError: boolean;
  cctvOffline: boolean;
}) {
  return (
    <div>
      <RouteVerdictBar verdict={verdict} />
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
}: {
  verdict: ReconVerdict;
  /** 判讀尚未回來 */
  verdictLoading: boolean;
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
}) {
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
        />
      ) : (
        <NoCctvStage
          verdict={verdict}
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
