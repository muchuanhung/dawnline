"use client";

import { useCallback, useMemo } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  ResponsiveContainer,
  ReferenceLine,
  ReferenceArea,
  ReferenceDot,
  Tooltip,
} from "recharts";
import { cn } from "@/lib/utils";
import type { ChartDataPoint, Hazard, RouteStage } from "@/lib/routes/recon-geo";
import { nearestByKm, rainLevel, windLevel } from "@/lib/routes/recon-geo";
import { nearestStop, stepStop, stopKey, type TrackStop } from "@/lib/routes/route-track";

// 非警示資訊一律低飽和；只有危險色帶用警示色
const LINE_COLOR = "var(--muted-foreground)";
const CURSOR_COLOR = "var(--foreground)";
const HAZARD_FILL = { risky: "var(--destructive)", caution: "var(--warning)" } as const;

function levelClass(level: "caution" | "risky" | null): string {
  if (level === "risky") return "text-destructive font-semibold";
  if (level === "caution") return "text-foreground font-semibold";
  return "text-foreground";
}

/**
 * 第 3 層：可拖曳的高程圖；游標處的海拔與天氣直接顯示在圖上方。
 * 有停點（路線頁傳入 stops／onSelectStop）時與里程軌道同一套規則：拖曳與方向鍵只停在鏡頭與示警路段起點，
 * 換站時才更新；鏡頭位置畫在圖底，與軌道下方的鏡頭點同一套樣式。沒有停點時（沙盤頁、沿途沒有鏡頭與示警）照舊連續拖曳。
 */
export function ElevationScrubber({
  data,
  hazards,
  positionKm,
  totalKm,
  stops = [],
  currentStop = null,
  onSelectStop,
  elevation,
  peakElevation,
  stage,
  onScrub,
}: {
  data: ChartDataPoint[];
  hazards: Hazard[];
  positionKm: number;
  totalKm: number;
  /** 與里程軌道共用的停點（見 trackStops） */
  stops?: TrackStop[];
  /** 目前停在哪個停點（見 currentStop） */
  currentStop?: TrackStop | null;
  onSelectStop?: (stop: TrackStop) => void;
  elevation: number;
  peakElevation: number;
  stage: RouteStage | null;
  /** 沒有停點時的連續移動 */
  onScrub: (km: number) => void;
}) {
  const snaps = onSelectStop != null && stops.length > 0;
  const currentKey = currentStop ? stopKey(currentStop) : null;

  /** 移到指定里程：有停點就跳到最近的停點（換站時才更新），沒有就連續移動 */
  const moveNear = useCallback(
    (km: number) => {
      if (!snaps) return onScrub(km);
      const stop = nearestStop(stops, km);
      if (stop && stopKey(stop) !== currentKey) onSelectStop(stop);
    },
    [snaps, stops, currentKey, onSelectStop, onScrub]
  );

  const handleScrub = useCallback(
    (state: { activePayload?: Array<{ payload: ChartDataPoint }> }) => {
      const p = state?.activePayload?.[0]?.payload;
      if (p) moveNear(p.km);
    },
    [moveNear]
  );

  /** 鍵盤：有停點時與軌道一樣逐站切換，不逐 0.1 km 移動 */
  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!snaps) return;
    const stop =
      e.key === "ArrowRight" || e.key === "ArrowUp"
        ? stepStop(stops, currentStop, positionKm, 1)
        : e.key === "ArrowLeft" || e.key === "ArrowDown"
          ? stepStop(stops, currentStop, positionKm, -1)
          : e.key === "Home"
            ? stops[0]!
            : e.key === "End"
              ? stops[stops.length - 1]!
              : undefined;
    if (stop === undefined) return;
    e.preventDefault();
    if (stop) onSelectStop(stop);
  };

  // 鏡頭停點的位置與該處海拔（底部畫點、虛線對到高程線），看得出拖到哪裡會停
  const cameraDots = useMemo(
    () =>
      stops.flatMap((s) =>
        s.kind === "marker"
          ? [{ key: stopKey(s), km: s.km, elevation: nearestByKm(data, s.km)?.elevation ?? 0 }]
          : []
      ),
    [stops, data]
  );

  // 超出預報時段的數值不可當真，比照無資料不顯示
  const outOfCoverage = (stage?.hasWeather && stage.outOfCoverage) ?? false;
  const hasWeather = (stage?.hasWeather ?? false) && !outOfCoverage;
  const rain = hasWeather && stage ? rainLevel(stage.rainProbability) : null;
  const wind = hasWeather && stage ? windLevel(stage.windSpeed) : null;
  // 約 100 格，取到 0.1 km
  const step = Math.max(0.1, Math.round(totalKm / 10) / 10);

  return (
    <section aria-label="海拔與位置" className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="font-mono text-sm tabular-nums">
          <span className="font-semibold text-foreground">{positionKm.toFixed(1)} km</span>
          <span className="text-muted-foreground"> · 海拔 </span>
          <span className="text-foreground">{Math.round(elevation)} m</span>
          {stage && <span className="text-muted-foreground"> · {stage.name}</span>}
        </p>
        <p className="text-xs tabular-nums text-muted-foreground">最高 {Math.round(peakElevation)} m</p>
      </div>

      <p className="font-mono text-sm tabular-nums text-muted-foreground">
        {hasWeather && stage ? (
          <>
            <span className="text-foreground">{stage.temperature}°C</span>
            <span> · 風 </span>
            <span className={cn(levelClass(wind))}>{stage.windSpeed} km/h</span>
            <span> · 雨 </span>
            <span className={cn(levelClass(rain))}>{stage.rainProbability}%</span>
          </>
        ) : outOfCoverage ? (
          "此處超出預報時段"
        ) : (
          "此處無天氣資料"
        )}
      </p>

      <div className="h-44 w-full min-w-0 sm:h-52">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={data}
            margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
            onMouseMove={handleScrub}
            onClick={handleScrub}
            {...({ onTouchMove: handleScrub } as Record<string, unknown>)}
          >
            <XAxis
              dataKey="km"
              type="number"
              domain={[0, "dataMax"]}
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
              tickFormatter={(v: number) => `${v.toFixed(0)} km`}
            />
            <YAxis
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
              tickFormatter={(v: number) => `${v.toFixed(0)} m`}
              width={48}
            />
            {hazards.map((h) =>
              h.endKm > h.startKm ? (
                <ReferenceArea
                  key={h.id}
                  x1={h.startKm}
                  x2={h.endKm}
                  fill={HAZARD_FILL[h.level]}
                  fillOpacity={0.18}
                  strokeOpacity={0}
                  ifOverflow="hidden"
                />
              ) : (
                // 單點示警（路況事件）沒有寬度，改畫垂直虛線
                <ReferenceLine
                  key={h.id}
                  x={h.startKm}
                  stroke={HAZARD_FILL[h.level]}
                  strokeWidth={2}
                  strokeDasharray="4 3"
                  ifOverflow="hidden"
                />
              )
            )}
            {/* 只為了取得 activePayload，不顯示浮動框 */}
            <Tooltip content={() => null} cursor={false} />
            <Area
              type="monotone"
              dataKey="elevation"
              stroke={LINE_COLOR}
              strokeWidth={1.5}
              fill={LINE_COLOR}
              fillOpacity={0.12}
              isAnimationActive={false}
            />
            {/* 鏡頭位置：與里程軌道下方同一排點（底線上，目前這台放大），淡虛線對到高程線上 */}
            {cameraDots.map((d) => {
              const active = d.key === currentKey;
              return [
                <ReferenceLine
                  key={`${d.key}-guide`}
                  segment={[
                    { x: d.km, y: 0 },
                    { x: d.km, y: d.elevation },
                  ]}
                  stroke={CURSOR_COLOR}
                  strokeOpacity={0.3}
                  strokeDasharray="2 3"
                  ifOverflow="hidden"
                />,
                <ReferenceDot
                  key={`${d.key}-dot`}
                  x={d.km}
                  y={0}
                  r={active ? 5 : 3}
                  fill={CURSOR_COLOR}
                  fillOpacity={active ? 1 : 0.45}
                  stroke="none"
                  ifOverflow="visible"
                />,
              ];
            })}
            <ReferenceLine x={positionKm} stroke={CURSOR_COLOR} strokeWidth={1.5} />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* 鍵盤與螢幕閱讀器用：左右鍵移動位置 */}
      <label className="sr-only" htmlFor="recon-position">
        目前位置（km）
      </label>
      <input
        id="recon-position"
        type="range"
        min={0}
        max={totalKm}
        step={step}
        value={positionKm}
        onChange={(e) => moveNear(Number(e.target.value))}
        onKeyDown={onKeyDown}
        className="sr-only focus:not-sr-only focus:w-full"
      />
    </section>
  );
}
