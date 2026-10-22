"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import type { RoutePolylineKm } from "@/lib/routes/recon-geo";
import {
  DBZ_COLORS,
  RADAR_VIEW,
  dbzFromColor,
  fitViewBox,
  legendTicks,
  LEGEND_TICKS_MM,
  pointAtKm,
  projectToExtent,
  rainRateLabel,
  type RadarResponse,
  type ViewInsets,
} from "@/lib/cwb/radar";

const { width: W, height: H } = RADAR_VIEW;

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
 * 回波以 SVG 模糊柔化 1.3 km 的格點方塊；圖與路線都投影到 RADAR_VIEW 座標，
 * 再依容器實際長寬比取景（fitViewBox），讓路線落在判定與底部列之間。
 */
export function RadarMap({
  radar,
  polyline,
  positionKm,
  compact = false,
  insets,
  className,
}: {
  radar: RadarResponse;
  polyline: RoutePolylineKm | null;
  positionKm: number;
  /** 子母畫面縮圖：線條加粗，看得出路線 */
  compact?: boolean;
  /** 上下被其他元件蓋住的比例 */
  insets: ViewInsets;
  className?: string;
}) {
  const filterId = useId();
  const svgRef = useRef<SVGSVGElement>(null);
  const aspect = useAspect(svgRef);
  const toView = (lat: number, lon: number) => {
    const [x, y] = projectToExtent(radar.extent, lat, lon);
    return [x * W, y * H] as const;
  };
  const route = useMemo(() => {
    if (!polyline) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const coords = polyline.points.map(([lat, lon]) => {
      const [fx, fy] = projectToExtent(radar.extent, lat, lon);
      const x = fx * W;
      const y = fy * H;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    return { d: "M" + coords.join("L"), box: { minX, minY, maxX, maxY } };
  }, [polyline, radar.extent]);
  const viewBox = route ? fitViewBox(route.box, aspect, insets).map((v) => v.toFixed(1)).join(" ") : `0 0 ${W} ${H}`;
  const start = polyline?.points[0];
  const here = polyline ? pointAtKm(polyline.points, polyline.cumulativeKm, positionKm) : null;
  // 線條粗細跟著取景縮放，縮圖與主視覺看起來一樣粗
  const scale = Number(viewBox.split(" ")[3]) / 200;
  const line = (compact ? 4 : 3) * scale;

  return (
    <svg
      ref={svgRef}
      viewBox={viewBox}
      preserveAspectRatio="xMidYMid slice"
      className={cn("block", className)}
      role="img"
      aria-label={`雷達回波 ${radarTimeLabel(radar.observedAt)} 觀測`}
    >
      <filter id={filterId} x="0" y="0" width="100%" height="100%">
        <feGaussianBlur stdDeviation="4" edgeMode="duplicate" />
      </filter>
      <rect width={W} height={H} fill="#0b1220" />
      <path d={radar.towns} fill="#1f2937" stroke="rgb(255 255 255 / 0.15)" strokeWidth={0.8} />
      <image
        href={radar.image}
        width={W}
        height={H}
        preserveAspectRatio="none"
        opacity={0.65}
        filter={`url(#${filterId})`}
      />
      {route && (
        <>
          <path d={route.d} fill="none" stroke="#000" strokeOpacity={0.7} strokeWidth={line * 2} strokeLinejoin="round" />
          <path d={route.d} fill="none" stroke="#fff" strokeWidth={line} strokeLinejoin="round" />
        </>
      )}
      {start && !compact && (
        <circle cx={toView(...start)[0]} cy={toView(...start)[1]} r={4 * scale} fill="#0b1220" stroke="#fff" strokeWidth={2 * scale} />
      )}
      {here && (
        <circle
          cx={toView(...here)[0]}
          cy={toView(...here)[1]}
          r={(compact ? 9 : 7) * scale}
          fill="#fff"
          className="stroke-primary"
          strokeWidth={(compact ? 5 : 4) * scale}
        />
      )}
    </svg>
  );
}

/** 元素目前的寬高比；量不到時當 4:3 */
function useAspect(ref: React.RefObject<Element | null>): number {
  const [aspect, setAspect] = useState(4 / 3);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const { width, height } = el.getBoundingClientRect();
      if (width > 0 && height > 0) setAspect(width / height);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return aspect;
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
          <span key={t.mm} className="absolute -translate-x-1/2 whitespace-nowrap tabular-nums" style={{ left: `${t.pct}%` }}>
            {t.mm}
            {t.mm === LEGEND_TICKS_MM.at(-1) && " mm/h"}
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * 目前位置的回波：把雷達圖畫進 canvas 取該點顏色，反查 dBZ。
 * 圖是同源 data URL，canvas 不會被汙染。載入前回 null。
 */
export function useRadarHere(
  radar: RadarResponse | null,
  polyline: RoutePolylineKm | null,
  positionKm: number
): string | null {
  const [pixels, setPixels] = useState<ImageData | null>(null);

  useEffect(() => {
    setPixels(null);
    if (!radar) return;
    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      if (cancelled) return;
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(img, 0, 0);
      setPixels(ctx.getImageData(0, 0, canvas.width, canvas.height));
    };
    img.src = radar.image;
    return () => {
      cancelled = true;
    };
  }, [radar]);

  if (!radar || !pixels || !polyline) return null;
  const here = pointAtKm(polyline.points, polyline.cumulativeKm, positionKm);
  if (!here) return null;
  const [fx, fy] = projectToExtent(radar.extent, here[0], here[1]);
  const x = Math.min(pixels.width - 1, Math.max(0, Math.floor(fx * pixels.width)));
  const y = Math.min(pixels.height - 1, Math.max(0, Math.floor(fy * pixels.height)));
  const i = (y * pixels.width + x) * 4;
  const d = pixels.data;
  const { echo, dbz } = dbzFromColor(d[i]!, d[i + 1]!, d[i + 2]!, d[i + 3]!);
  if (!echo) return "此處無回波";
  return dbz == null ? "此處回波很強" : `此處${rainRateLabel(dbz)}`;
}
