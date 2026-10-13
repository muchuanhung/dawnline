"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Box, Pause, Play, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useRoutesFromStorage } from "@/hooks/useRoutesFromStorage";
import { useRouteCCTV } from "@/hooks/useRouteCCTV";
import { useRouteBriefing, verdictOf } from "@/hooks/useRouteBriefing";
import {
  buildCctvMarkers,
  buildRoutePolylineKm,
  deriveStages,
  nearestByKm,
  routeTotalKm,
  stageAtKm,
  type CctvMarker,
  type ChartDataPoint,
} from "@/lib/routes/recon-geo";
import type { TerrainGrid } from "@/lib/lab/terrain";
import { RouteVerdictBar } from "@/components/routes/recon/route-verdict-bar";
import { HazardList } from "@/components/routes/recon/hazard-list";
import { ElevationScrubber } from "@/components/routes/recon/elevation-scrubber";
import { CctvViewer } from "@/components/routes/recon/cctv-viewer";
import { CctvStrip } from "@/components/routes/recon/cctv-strip";
import { CctvCoverageBar } from "./cctv-coverage-bar";

// three.js 只在真的要顯示 3D 時才下載（桌機進頁、手機點開全螢幕）
const TerrainScene = dynamic(() => import("./terrain-scene"), {
  ssr: false,
  loading: () => <StageMessage>載入 3D 地形…</StageMessage>,
});

/** 監視器覆蓋半徑：播放頭在鏡頭這個距離內才顯示該鏡頭 */
const COVER_KM = 1;
/** 離路線超過這個距離的鏡頭不算「沿線」 */
const ON_ROUTE_KM = 0.8;
/** 播放一趟全程的秒數 */
const PLAY_SECONDS = 45;

const DESKTOP_QUERY = "(min-width: 1024px)";
function useIsDesktop() {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia(DESKTOP_QUERY);
      mq.addEventListener("change", cb);
      return () => mq.removeEventListener("change", cb);
    },
    () => window.matchMedia(DESKTOP_QUERY).matches,
    () => false
  );
}

type TerrainState =
  | { status: "idle" | "loading" | "missing" | "error" }
  | { status: "ready"; grid: TerrainGrid };

function useTerrain(routeId: string | undefined): TerrainState {
  const [state, setState] = useState<TerrainState>({ status: "idle" });
  useEffect(() => {
    if (!routeId) return;
    let cancelled = false;
    setState({ status: "loading" });
    fetch(`/api/lab/terrain?routeId=${encodeURIComponent(routeId)}`)
      .then(async (res) => {
        if (cancelled) return;
        if (res.status === 404) return setState({ status: "missing" });
        if (!res.ok) throw new Error(`terrain ${res.status}`);
        const grid = (await res.json()) as TerrainGrid;
        if (!cancelled) setState({ status: "ready", grid });
      })
      .catch(() => !cancelled && setState({ status: "error" }));
    return () => {
      cancelled = true;
    };
  }, [routeId]);
  return state;
}

export function RouteSimClient() {
  const { routes, loading, error } = useRoutesFromStorage();
  const [routeId, setRouteId] = useState("");
  const route = routes.find((r) => r.id === routeId) ?? routes[0] ?? null;

  // 判定與合併天氣的路段由伺服器提供（與 Dashboard、/routes 同一流程）
  const briefing = useRouteBriefing(route?.id);
  const briefedSegments = briefing.briefing?.segments;
  const enriched = useMemo(
    () => (route ? { ...route, segments: briefedSegments ?? route.segments } : null),
    [route, briefedSegments]
  );
  const { feeds, loading: cctvLoading, error: cctvError } = useRouteCCTV(route);
  const terrain = useTerrain(route?.id);

  const polyline = useMemo(() => (enriched ? buildRoutePolylineKm(enriched) : null), [enriched]);
  const markers = useMemo(
    () =>
      enriched
        ? buildCctvMarkers(enriched, feeds, polyline).filter(
            (m) => m.distToRouteKm != null && m.distToRouteKm <= ON_ROUTE_KM
          )
        : [],
    [enriched, feeds, polyline]
  );
  const stages = useMemo(() => (enriched ? deriveStages(enriched) : []), [enriched]);
  const hazards = useMemo(() => briefing.briefing?.hazards ?? [], [briefing.briefing]);
  const verdict = verdictOf(briefing);
  const chartData = useMemo<ChartDataPoint[]>(
    () => (route?.elevationProfile ?? []).map(([km, elevation]) => ({ km, elevation })),
    [route]
  );
  const totalKm = route ? routeTotalKm(route) : 0;

  // ── 共用播放頭：3D、剖面、示警、監視器全部讀這個 ──
  const [km, setKmState] = useState(0);
  const [playing, setPlaying] = useState(false);
  const setKm = useCallback((k: number) => setKmState(Math.max(0, Math.min(totalKm, k))), [totalKm]);
  useEffect(() => {
    setKmState(0);
    setPlaying(false);
  }, [route?.id]);

  const totalRef = useRef(totalKm);
  totalRef.current = totalKm;
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const total = totalRef.current;
      if (total > 0) setKmState((k) => (k + (dt * total) / PLAY_SECONDS) % total);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  const activeMarker = useMemo<CctvMarker | null>(() => {
    const near = nearestByKm(markers, km);
    return near && Math.abs(near.km - km) <= COVER_KM ? near : null;
  }, [markers, km]);
  const currentStage = useMemo(() => stageAtKm(stages, km), [stages, km]);
  const currentElevation = useMemo(() => nearestByKm(chartData, km)?.elevation ?? 0, [chartData, km]);
  const peakElevation = useMemo(
    () => (chartData.length ? Math.max(...chartData.map((d) => d.elevation)) : 0),
    [chartData]
  );

  const isDesktop = useIsDesktop();
  const [sheetOpen, setSheetOpen] = useState(false);
  useEffect(() => {
    if (isDesktop) setSheetOpen(false);
  }, [isDesktop]);

  if (loading) return <PageMessage>載入路線中…</PageMessage>;
  if (error) return <PageMessage>{error}</PageMessage>;
  if (!route || !enriched) return <PageMessage>尚無路線</PageMessage>;

  const sceneProps = {
    route: enriched,
    hazards,
    markers,
    positionKm: km,
    activeMarkerId: activeMarker?.id ?? null,
    onPickMarker: (m: CctvMarker) => setKm(m.km),
    onPickKm: setKm,
  };
  const readout = `${km.toFixed(1)} km · 海拔 ${Math.round(currentElevation)} m`;
  const terrainGrid = terrain.status === "ready" ? terrain.grid : null;
  const playLabel = playing ? "暫停" : "播放";

  const cctvBlock = (
    <div className="space-y-3">
      <CctvViewer marker={activeMarker} positionKm={km} loading={cctvLoading} />
      <CctvCoverageBar markers={markers} totalKm={totalKm} coverKm={COVER_KM} positionKm={km} onSelect={setKm} />
      <CctvStrip
        markers={markers}
        activeId={activeMarker?.id ?? null}
        loading={cctvLoading}
        error={cctvError}
        onSelect={setKm}
      />
    </div>
  );

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-4 py-3 lg:px-6">
          <h1 className="text-lg font-black">路線沙盤</h1>
          <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">實驗</span>
          <label className="ml-auto flex items-center gap-2 text-sm text-muted-foreground">
            路線
            <select
              value={route.id}
              onChange={(e) => setRouteId(e.target.value)}
              className="max-w-[60vw] rounded-full border border-border bg-background px-3 py-1.5 text-sm text-foreground"
            >
              {routes.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.nameZh || r.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      </header>

      {/* 手機也要明確給 minmax(0,1fr)，否則可橫向捲動的縮圖列會把欄位與整頁撐寬 */}
      <main className="mx-auto grid max-w-7xl grid-cols-[minmax(0,1fr)] gap-6 px-4 py-5 lg:grid-cols-[340px_minmax(0,1fr)] lg:px-6">
        <aside className="flex min-w-0 flex-col gap-5">
          <RouteVerdictBar verdict={verdict} />
          <HazardList hazards={hazards} positionKm={km} onJump={setKm} />
          {isDesktop && cctvBlock}
        </aside>

        <section className="flex min-w-0 flex-col gap-4" aria-label="三維地形與剖面">
          {isDesktop ? (
            <div className="relative h-[min(62vh,560px)] overflow-hidden rounded-2xl border border-border bg-[radial-gradient(120%_100%_at_50%_0%,#F7F8F2,#DDE2D0)]">
              <TerrainScene {...sceneProps} terrain={terrainGrid} />
              <TerrainStatus terrain={terrain} />
              <p className="pointer-events-none absolute left-3 top-3 max-w-[calc(100%-1.5rem)] truncate rounded-lg border border-border bg-background/90 px-3 py-1.5 font-mono text-sm">
                {readout}
                {activeMarker && <span className="font-sans font-bold">・監視器 {activeMarker.name}</span>}
              </p>
              <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-3 rounded-full border border-border bg-background/95 px-3 py-1.5 shadow-md">
                <Button size="sm" className="rounded-full" onClick={() => setPlaying((p) => !p)}>
                  {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                  {playLabel}
                </Button>
                <span className="text-xs text-muted-foreground">點路線或鏡頭，跳到該處</span>
              </div>
            </div>
          ) : (
            <MobileTerrainCard chartData={chartData} onOpen={() => setSheetOpen(true)} />
          )}

          <ElevationScrubber
            data={chartData}
            hazards={hazards}
            positionKm={km}
            totalKm={totalKm}
            elevation={currentElevation}
            peakElevation={peakElevation}
            stage={currentStage}
            onScrub={setKm}
          />
          {!isDesktop && cctvBlock}
        </section>
      </main>

      {!isDesktop && sheetOpen && (
        <MobileTerrainSheet
          title={`${route.nameZh || route.name}・3D 地形`}
          readout={readout}
          cameraLine={activeMarker ? `監視器：${activeMarker.name}（${activeMarker.km.toFixed(1)} km）` : "此路段無監視器"}
          playing={playing}
          onTogglePlay={() => setPlaying((p) => !p)}
          onClose={() => setSheetOpen(false)}
        >
          <TerrainScene {...sceneProps} terrain={terrainGrid} lowDetail />
          <TerrainStatus terrain={terrain} />
        </MobileTerrainSheet>
      )}
    </div>
  );
}

/** 地形狀態疊在畫布上方；畫布本身不因載入而卸載 */
function TerrainStatus({ terrain }: { terrain: TerrainState }) {
  if (terrain.status === "ready") return null;
  const text =
    terrain.status === "missing"
      ? "此路線尚未產生地形資料"
      : terrain.status === "error"
        ? "地形資料載入失敗"
        : "載入地形資料…";
  return (
    <div className="pointer-events-none absolute inset-0">
      <StageMessage>{text}</StageMessage>
    </div>
  );
}

function StageMessage({ children }: { children: React.ReactNode }) {
  return <div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">{children}</div>;
}

function PageMessage({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-screen items-center justify-center p-6 text-sm text-muted-foreground">{children}</div>;
}

/** 手機：3D 收成一張卡，縮圖用真實海拔剖面；點開才下載 three.js */
function MobileTerrainCard({ chartData, onOpen }: { chartData: ChartDataPoint[]; onOpen: () => void }) {
  const w = 320;
  const h = 64;
  const total = chartData[chartData.length - 1]?.km || 1;
  const max = Math.max(1, ...chartData.map((d) => d.elevation));
  const line = chartData
    .map((d, i) => `${i ? "L" : "M"}${((d.km / total) * w).toFixed(1)} ${(h - 4 - (d.elevation / max) * (h - 10)).toFixed(1)}`)
    .join(" ");
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-haspopup="dialog"
      className="flex w-full flex-col gap-2 rounded-2xl border border-border bg-card p-4 text-left shadow-sm"
    >
      <svg viewBox={`0 0 ${w} ${h}`} className="block h-auto w-full" aria-hidden>
        <path d={`${line} L${w} ${h} L0 ${h} Z`} fill="#2F5D3E" opacity="0.16" />
        <path d={line} fill="none" stroke="#2F5D3E" strokeWidth="1.8" />
      </svg>
      <span className="flex w-full items-baseline justify-between gap-2">
        <span className="flex items-center gap-2 font-bold">
          <Box className="h-4 w-4" aria-hidden />
          3D 地形與監視器
        </span>
        <span className="text-xs text-muted-foreground">點開全螢幕</span>
      </span>
    </button>
  );
}

function MobileTerrainSheet({
  title,
  readout,
  cameraLine,
  playing,
  onTogglePlay,
  onClose,
  children,
}: {
  title: string;
  readout: string;
  cameraLine: string;
  playing: boolean;
  onTogglePlay: () => void;
  onClose: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    document.body.classList.add("overflow-hidden");
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.classList.remove("overflow-hidden");
    };
  }, [onClose]);

  return (
    <div role="dialog" aria-modal="true" aria-label={title} className="fixed inset-0 z-50 flex flex-col bg-background">
      <div className="flex items-center justify-between px-4 pb-2 pt-[max(1rem,env(safe-area-inset-top))]">
        <b className="truncate">{title}</b>
        <Button variant="outline" size="icon" className="rounded-full" onClick={onClose} aria-label="關閉">
          <X className="h-4 w-4" />
        </Button>
      </div>
      <div className="relative min-h-0 flex-1 touch-none bg-[radial-gradient(120%_100%_at_50%_0%,#F7F8F2,#DDE2D0)]">
        {children}
      </div>
      <div className="flex flex-col gap-2 border-t border-border bg-background px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
        <p className="font-mono text-sm">{readout}</p>
        <p className="text-xs text-muted-foreground">{cameraLine}</p>
        <div className="flex items-center gap-3">
          <Button size="sm" className="rounded-full" onClick={onTogglePlay}>
            {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            {playing ? "暫停" : "播放"}
          </Button>
          <span className="text-xs text-muted-foreground">單指旋轉・雙指縮放</span>
        </div>
      </div>
    </div>
  );
}
