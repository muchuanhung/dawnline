"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";
import { cn } from "@/lib/utils";
import type { RoutePolylineKm } from "@/lib/routes/recon-geo";
import { radarFrameUrl, type RouteRadar } from "@/hooks/useRouteRadar";
import {
  DBZ_COLORS,
  RADAR_EXTENT,
  RADAR_VIEW,
  dbzFromColor,
  legendTicks,
  pointAtKm,
  projectToExtent,
  projectToView,
  radarViewBox,
  rainRateLabel,
  type RadarFrame,
  type RadarZoom,
  type ViewInsets,
} from "@/lib/cwb/radar";

const { width: W, height: H } = RADAR_VIEW;

/** 回放每張停留的時間，最新一張多停一下 */
const FRAME_MS = 600;
const LAST_FRAME_MS = 1800;

/** 觀測時間 HH:MM（台灣時間） */
export function radarTimeLabel(observedAt: string): string {
  return new Date(observedAt).toLocaleTimeString("zh-TW", {
    timeZone: "Asia/Taipei",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/**
 * 雷達圖：深色底的鄉鎮界＋回波＋路線＋目前位置。主視覺一律是深色底，淺色主題也一樣。
 * 回放的每張圖都疊在同一個 SVG，只顯示 frameIndex 那張，換張不用重新下載。
 * 取景（周邊／全台）只改 viewBox；線寬依實際像素換算，縮放時粗細不變。
 */
export function RadarMap({
  radar,
  frameIndex,
  polyline,
  positionKm,
  zoom = "near",
  compact = false,
  insets,
  className,
}: {
  radar: RouteRadar;
  /** 顯示第幾張；子母畫面一律只畫最新一張 */
  frameIndex?: number;
  polyline: RoutePolylineKm | null;
  positionKm: number;
  zoom?: RadarZoom;
  /** 子母畫面縮圖：線條加粗，看得出路線 */
  compact?: boolean;
  /** 上下被其他元件蓋住的比例 */
  insets: ViewInsets;
  className?: string;
}) {
  const filterId = useId();
  const svgRef = useRef<SVGSVGElement>(null);
  const size = useSize(svgRef);
  const [vx, vy, vw, vh] = radarViewBox(radar.routeBox, zoom, size.width / size.height, insets);
  // 每像素多少地圖單位；元素量不到時以 viewBox 高 200 px 估
  const px = vh / (size.height || 200);
  const route = useMemo(
    () =>
      polyline
        ? "M" + polyline.points.map(([lat, lon]) => projectToView(lat, lon).map((v) => v.toFixed(2)).join(",")).join("L")
        : null,
    [polyline]
  );
  const start = polyline?.points[0];
  const here = polyline ? pointAtKm(polyline.points, polyline.cumulativeKm, positionKm) : null;
  const latest = radar.frames.length - 1;
  const shown = compact ? latest : Math.min(frameIndex ?? latest, latest);
  const frames = compact ? radar.frames.slice(-1) : radar.frames;
  const line = (compact ? 3 : 2.5) * px;

  return (
    <svg
      ref={svgRef}
      viewBox={`${vx.toFixed(2)} ${vy.toFixed(2)} ${vw.toFixed(2)} ${vh.toFixed(2)}`}
      preserveAspectRatio="xMidYMid slice"
      className={cn("block bg-[#0b1220]", className)}
      role="img"
      aria-label={`雷達回波 ${radarTimeLabel(radar.frames[shown]!.observedAt)} 觀測`}
    >
      {/* 柔化約 1.3 km 的格點方塊 */}
      <filter id={filterId}>
        <feGaussianBlur stdDeviation={Math.max(0.8, 1.5 * px)} />
      </filter>
      <rect width={W} height={H} fill="#0b1220" />
      <path d={radar.towns} fill="#1f2937" stroke="rgb(255 255 255 / 0.15)" strokeWidth={0.8 * px} />
      <g filter={`url(#${filterId})`}>
        {frames.map((f: RadarFrame) => (
          <image
            key={f.id}
            href={radarFrameUrl(f)}
            width={W}
            height={H}
            preserveAspectRatio="none"
            opacity={f === radar.frames[shown] ? 0.7 : 0}
          />
        ))}
      </g>
      {route && (
        <>
          <path d={route} fill="none" stroke="#000" strokeOpacity={0.7} strokeWidth={line * 2} strokeLinejoin="round" />
          <path d={route} fill="none" stroke="#fff" strokeWidth={line} strokeLinejoin="round" />
        </>
      )}
      {start && !compact && (
        <circle
          cx={projectToView(...start)[0]}
          cy={projectToView(...start)[1]}
          r={4 * px}
          fill="#0b1220"
          stroke="#fff"
          strokeWidth={2 * px}
        />
      )}
      {here && (
        <circle
          cx={projectToView(...here)[0]}
          cy={projectToView(...here)[1]}
          r={(compact ? 6 : 6) * px}
          fill="#fff"
          className="stroke-primary"
          strokeWidth={(compact ? 3.5 : 3) * px}
        />
      )}
    </svg>
  );
}

/** 元素目前的寬高；量不到時當 4:3 */
function useSize(ref: React.RefObject<Element | null>): { width: number; height: number } {
  const [size, setSize] = useState({ width: 4, height: 3 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const { width, height } = el.getBoundingClientRect();
      if (width > 0 && height > 0) setSize({ width, height });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

/**
 * 預先下載每張圖，回傳已載入的 id。圖還沒到的那張不能顯示：
 * 空白的地圖看起來像「沒有雨」，未載入 ≠ 沒有回波。
 */
export function useRadarFramesLoaded(frames: RadarFrame[]): Set<string> {
  const [loaded, setLoaded] = useState<Set<string>>(() => new Set());
  const key = frames.map((f) => f.id).join(",");
  useEffect(() => {
    let cancelled = false;
    for (const f of frames) {
      const img = new Image();
      img.onload = () => {
        if (!cancelled) setLoaded((prev) => (prev.has(f.id) ? prev : new Set(prev).add(f.id)));
      };
      img.src = radarFrameUrl(f);
    }
    return () => {
      cancelled = true;
    };
    // frames 以 id 串比對，同一輪圖不重抓
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return loaded;
}

/**
 * 回放：全部載入後自動由舊到新循環，最新一張多停一下；使用者點時間軸就停在那張。
 * 系統設定「減少動態」時不自動播放，停在最新一張。
 */
export function useRadarPlayback(frames: RadarFrame[], ready: boolean) {
  const count = frames.length;
  const latestId = frames.at(-1)?.id;
  const [index, setIndex] = useState(count - 1);
  const [playing, setPlaying] = useState(false);

  // 換了一輪圖（新觀測進來）就回到最新一張，載入完再播
  useEffect(() => {
    setIndex(count - 1);
    setPlaying(false);
  }, [latestId, count]);

  useEffect(() => {
    if (!ready || count < 2) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    setIndex(0);
    setPlaying(true);
  }, [ready, count, latestId]);

  useEffect(() => {
    if (!playing || count < 2) return;
    const timer = setTimeout(() => setIndex((i) => (i + 1) % count), index === count - 1 ? LAST_FRAME_MS : FRAME_MS);
    return () => clearTimeout(timer);
  }, [playing, index, count]);

  return {
    index: Math.min(index, count - 1),
    playing,
    toggle: () => setPlaying((p) => !p),
    seek: (i: number) => {
      setPlaying(false);
      setIndex(i);
    },
  };
}

/** 播放列：播放／暫停、每張一格的時間軸（可點）、周邊／全台 */
export function RadarControls({
  frames,
  loaded,
  index,
  playing,
  onToggle,
  onSeek,
  zoom,
  onZoom,
  className,
}: {
  frames: RadarFrame[];
  /** 已載入的圖；沒載入的格子不能點 */
  loaded: Set<string>;
  index: number;
  playing: boolean;
  onToggle: () => void;
  onSeek: (i: number) => void;
  zoom: RadarZoom;
  onZoom: (z: RadarZoom) => void;
  className?: string;
}) {
  const current = frames[index]!;
  const isLatest = index === frames.length - 1;
  return (
    <div className={cn("flex items-center gap-2 text-white", className)}>
      <button
        type="button"
        onClick={onToggle}
        disabled={frames.length < 2 || loaded.size < frames.length}
        aria-label={playing ? "暫停回放" : "播放過去 6 小時"}
        className="flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-full bg-white/15 hover:bg-white/25 disabled:opacity-40"
      >
        {playing ? <Pause className="size-4" aria-hidden /> : <Play className="size-4" aria-hidden />}
      </button>
      <p className="w-[4.5rem] shrink-0 text-sm font-semibold tabular-nums" aria-live="off">
        {radarTimeLabel(current.observedAt)}
        {isLatest && <span className="ml-1 text-[10px] font-normal text-white/70">最新</span>}
      </p>
      <div role="group" aria-label="雷達觀測時間" className="flex h-9 min-w-0 flex-1 items-center gap-0.5">
        {frames.map((f, i) => (
          <button
            key={f.id}
            type="button"
            onClick={() => onSeek(i)}
            disabled={!loaded.has(f.id)}
            aria-label={`${radarTimeLabel(f.observedAt)} 的雷達圖`}
            aria-pressed={i === index}
            className="flex h-full flex-1 cursor-pointer items-center disabled:cursor-wait disabled:opacity-40"
          >
            <span className={cn("h-1.5 w-full rounded-full", i === index ? "bg-white" : i < index ? "bg-white/50" : "bg-white/20")} />
          </button>
        ))}
      </div>
      <div role="group" aria-label="雷達範圍" className="flex shrink-0 rounded-full bg-white/15 p-0.5 text-xs font-medium">
        {(
          [
            ["near", "周邊"],
            ["taiwan", "全台"],
          ] as const
        ).map(([z, label]) => (
          <button
            key={z}
            type="button"
            aria-pressed={zoom === z}
            onClick={() => onZoom(z)}
            className={cn(
              "cursor-pointer rounded-full px-2.5 py-1.5",
              zoom === z ? "bg-white text-black" : "text-white/80 hover:text-white"
            )}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** 色階圖例：顏色依 CWA dBZ 色階，刻度換算成 mm/h */
export function RadarLegend({ className }: { className?: string }) {
  const gradient = useMemo(
    () =>
      `linear-gradient(90deg, ${DBZ_COLORS.map(([r, g, b], i) => `rgb(${r},${g},${b}) ${((i / (DBZ_COLORS.length - 1)) * 100).toFixed(1)}%`).join(", ")})`,
    []
  );
  return (
    <div className={cn("text-[10px] leading-none text-white/80", className)}>
      <div className="h-1.5 rounded-full opacity-80" style={{ backgroundImage: gradient }} />
      <div className="relative mt-1 h-2.5">
        {legendTicks().map((t) => (
          <span key={t.mm} className="absolute -translate-x-1/2 tabular-nums" style={{ left: `${t.pct}%` }}>
            {t.mm}
          </span>
        ))}
        {/* 最弱的一段沒有刻度，單位放在左端，窄螢幕也不會和刻度擠在一起 */}
        <span className="absolute left-0">mm/h</span>
      </div>
    </div>
  );
}

/** 已解碼的圖（同源 PNG），同一張只畫進 canvas 一次 */
const pixelCache = new Map<string, Promise<ImageData | null>>();
function loadPixels(url: string): Promise<ImageData | null> {
  let hit = pixelCache.get(url);
  if (!hit) {
    hit = new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext("2d");
        if (!ctx) return resolve(null);
        ctx.drawImage(img, 0, 0);
        resolve(ctx.getImageData(0, 0, canvas.width, canvas.height));
      };
      img.onerror = () => {
        pixelCache.delete(url);
        resolve(null);
      };
      img.src = url;
    });
    pixelCache.set(url, hit);
    while (pixelCache.size > 16) pixelCache.delete(pixelCache.keys().next().value!);
  }
  return hit;
}

/**
 * 目前位置在某張圖上的回波：取該點顏色反查 dBZ。載入前回 null。
 */
export function useRadarHere(
  frame: RadarFrame | null,
  polyline: RoutePolylineKm | null,
  positionKm: number
): string | null {
  const url = frame ? radarFrameUrl(frame) : null;
  const [pixels, setPixels] = useState<{ url: string; data: ImageData } | null>(null);

  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    void loadPixels(url).then((data) => {
      if (!cancelled && data) setPixels({ url, data });
    });
    return () => {
      cancelled = true;
    };
  }, [url]);

  if (!url || pixels?.url !== url || !polyline) return null;
  const here = pointAtKm(polyline.points, polyline.cumulativeKm, positionKm);
  if (!here) return null;
  const { data } = pixels;
  const [fx, fy] = projectToExtent(RADAR_EXTENT, here[0], here[1]);
  const x = Math.min(data.width - 1, Math.max(0, Math.floor(fx * data.width)));
  const y = Math.min(data.height - 1, Math.max(0, Math.floor(fy * data.height)));
  const i = (y * data.width + x) * 4;
  const d = data.data;
  const { echo, dbz } = dbzFromColor(d[i]!, d[i + 1]!, d[i + 2]!, d[i + 3]!);
  if (!echo) return "此處無回波";
  return dbz == null ? "此處回波很強" : `此處${rainRateLabel(dbz)}`;
}
