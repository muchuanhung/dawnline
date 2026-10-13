"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CctvMarker } from "@/lib/routes/recon-geo";
import {
  markerOrdinal,
  nearestStop,
  stepStop,
  stopKey,
  trackStops,
  trackTicks,
  type TrackFlag,
  type TrackStop,
} from "@/lib/routes/route-track";

const FLAG_DOT = { risky: "bg-destructive", caution: "bg-warning" } as const;
const FLAG_THUMB = { risky: "border-destructive", caution: "border-warning" } as const;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/**
 * 里程軌道：粗條＋大拇指點。拖曳與 ‹ › 只停在鏡頭與示警（停點），中間的公里數不停；
 * 示警點嵌在軌道上，停到示警時展開說明。沒有任何停點的路線才連續拖曳。
 * 只標整數刻度、不畫鏡頭刻度（見 lib/routes/route-track）。
 */
export function RouteTrack({
  totalKm,
  positionKm,
  markers,
  activeMarker,
  flags,
  activeFlag,
  onMove,
  onSelectMarker,
  onSelectFlag,
}: {
  totalKm: number;
  positionKm: number;
  markers: CctvMarker[];
  activeMarker: CctvMarker | null;
  flags: TrackFlag[];
  activeFlag: TrackFlag | null;
  /** 沒有停點時的連續拖曳、鍵盤移動 */
  onMove: (km: number) => void;
  /** 停到鏡頭（同一點有多台時要指定是哪一台） */
  onSelectMarker: (marker: CctvMarker) => void;
  /** 停到示警 */
  onSelectFlag: (flag: TrackFlag) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const ticks = useMemo(() => trackTicks(totalKm), [totalKm]);
  const stops = useMemo(() => trackStops(markers, flags), [markers, flags]);
  const at = (km: number) => (totalKm > 0 ? clamp01(km / totalKm) : 0);
  const pct = `${at(positionKm) * 100}%`;

  // 目前停在哪個停點：展開中的示警優先，其次是剛好停在該里程的鏡頭
  const current: TrackStop | null = activeFlag
    ? { kind: "flag", km: activeFlag.km, flag: activeFlag }
    : activeMarker && activeMarker.km === positionKm
      ? { kind: "marker", km: activeMarker.km, marker: activeMarker }
      : null;
  const currentKey = current ? stopKey(current) : null;

  const selectStop = (stop: TrackStop) => {
    if (stop.kind === "marker") onSelectMarker(stop.marker);
    else onSelectFlag(stop.flag);
  };

  const kmAt = useCallback(
    (clientX: number) => {
      const rect = trackRef.current?.getBoundingClientRect();
      if (!rect || rect.width === 0) return positionKm;
      return Math.round(clamp01((clientX - rect.left) / rect.width) * totalKm * 10) / 10;
    },
    [positionKm, totalKm]
  );

  /** 拖曳中：有停點就跳到最近的停點（換站時才更新），沒有就連續移動 */
  const dragTo = (clientX: number) => {
    const km = kmAt(clientX);
    const stop = nearestStop(stops, km);
    if (!stop) onMove(km);
    else if (stopKey(stop) !== currentKey) selectStop(stop);
  };

  const keyStep = Math.max(0.1, Math.round(totalKm) / 100);
  const onKeyDown = (e: React.KeyboardEvent) => {
    const forward = e.key === "ArrowRight" || e.key === "ArrowUp";
    const back = e.key === "ArrowLeft" || e.key === "ArrowDown";
    if (stops.length > 0) {
      const stop = forward
        ? stepStop(stops, current, positionKm, 1)
        : back
          ? stepStop(stops, current, positionKm, -1)
          : e.key === "Home"
            ? stops[0]!
            : e.key === "End"
              ? stops[stops.length - 1]!
              : undefined;
      if (stop === undefined) return;
      e.preventDefault();
      if (stop) selectStop(stop);
      return;
    }
    const next = forward
      ? positionKm + keyStep
      : back
        ? positionKm - keyStep
        : e.key === "Home"
          ? 0
          : e.key === "End"
            ? totalKm
            : null;
    if (next == null) return;
    e.preventDefault();
    onMove(Math.round(Math.min(totalKm, Math.max(0, next)) * 10) / 10);
  };

  const prev = stepStop(stops, current, positionKm, -1);
  const next = stepStop(stops, current, positionKm, 1);
  const ordinal = markerOrdinal(markers, current?.kind === "marker" ? current.marker : null);
  const kmText = `${positionKm.toFixed(1)} km`;
  const caption =
    current?.kind === "flag" ? (
      <span className="font-medium">
        示警 {current.flag.hazards.length} 項・{kmText}
      </span>
    ) : markers.length >= 2 && ordinal != null ? (
      <>
        第 <b className="tabular-nums">{ordinal}</b>／{markers.length} 台・{kmText}
      </>
    ) : markers.length === 1 ? (
      `沿途 1 台・${kmText}`
    ) : (
      kmText
    );
  const valueText = current?.kind === "flag" ? `${kmText}，示警 ${current.flag.hazards.length} 項` : kmText;

  return (
    <div className="space-y-1 pt-3 pb-2">
      <div className="px-4">
        <div
          ref={trackRef}
          role="slider"
          tabIndex={0}
          aria-label="沿路線位置"
          aria-valuemin={0}
          aria-valuemax={totalKm}
          aria-valuenow={positionKm}
          aria-valuetext={valueText}
          onKeyDown={onKeyDown}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            setDragging(true);
            dragTo(e.clientX);
          }}
          onPointerMove={(e) => {
            if (dragging) dragTo(e.clientX);
          }}
          onPointerUp={() => setDragging(false)}
          onPointerCancel={() => setDragging(false)}
          className="relative h-11 cursor-pointer touch-none select-none rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <div className="absolute inset-x-0 top-1/2 h-3 -translate-y-1/2 rounded-full bg-border" aria-hidden />
          <div className="absolute left-0 top-1/2 h-3 -translate-y-1/2 rounded-full bg-primary" style={{ width: pct }} aria-hidden />
          {/* 示警點嵌在軌道上：本身就是停點，拖到或點到就停下並展開說明 */}
          {flags.map((f) => (
            <span
              key={`${f.km}-${f.hazards[0]?.id}`}
              className={cn(
                "absolute top-1/2 flex size-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-card text-[11px] font-bold leading-none text-white",
                FLAG_DOT[f.level]
              )}
              style={{ left: `${at(f.km) * 100}%` }}
              aria-hidden
            >
              {f.hazards.length > 1 ? f.hazards.length : "!"}
            </span>
          ))}
          <div
            className={cn(
              "absolute top-1/2 size-[26px] -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] bg-card shadow-sm transition-transform",
              current?.kind === "flag" ? FLAG_THUMB[current.flag.level] : "border-primary",
              dragging && "scale-110 ring-8 ring-primary/15"
            )}
            style={{ left: pct }}
            aria-hidden
          />
        </div>

        <div className="relative h-4 text-[11px] tabular-nums text-muted-foreground" aria-hidden>
          {ticks.map((t, i) => (
            <span
              key={t.km}
              className={cn(
                "absolute top-0",
                i === 0 ? "left-0" : t.at === 1 ? "right-0" : "-translate-x-1/2"
              )}
              style={i === 0 || t.at === 1 ? undefined : { left: `${t.at * 100}%` }}
            >
              {t.at === 1 ? `${t.km} km` : t.km}
            </span>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between px-1">
        {stops.length >= 2 ? (
          <button
            type="button"
            onClick={() => prev && selectStop(prev)}
            disabled={!prev}
            aria-label="上一個鏡頭或示警"
            className="flex size-11 cursor-pointer items-center justify-center rounded-full text-foreground disabled:cursor-default disabled:text-muted-foreground/40"
          >
            <ChevronLeft className="size-5" aria-hidden />
          </button>
        ) : (
          <span className="size-11" aria-hidden />
        )}
        <p className="text-sm text-foreground">
          {caption}
        </p>
        {stops.length >= 2 ? (
          <button
            type="button"
            onClick={() => next && selectStop(next)}
            disabled={!next}
            aria-label="下一個鏡頭或示警"
            className="flex size-11 cursor-pointer items-center justify-center rounded-full text-foreground disabled:cursor-default disabled:text-muted-foreground/40"
          >
            <ChevronRight className="size-5" aria-hidden />
          </button>
        ) : (
          <span className="size-11" aria-hidden />
        )}
      </div>
    </div>
  );
}
