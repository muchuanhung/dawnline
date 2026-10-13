"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CctvMarker } from "@/lib/routes/recon-geo";
import {
  markerOrdinal,
  snapToMarker,
  stepMarker,
  trackTicks,
  type TrackFlag,
} from "@/lib/routes/route-track";

const FLAG_COLOR = { risky: "bg-destructive text-destructive-foreground", caution: "bg-warning text-warning-foreground" } as const;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/**
 * 里程軌道：粗條＋大拇指點，拖曳換鏡頭；上方紅色旗標為示警，下方 ‹ › 逐台切換。
 * 只標整數刻度、不畫鏡頭刻度，放開時吸附到附近的鏡頭（見 lib/routes/route-track）。
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
  /** 拖曳、鍵盤移動 */
  onMove: (km: number) => void;
  /** ‹ › 逐台切換（同一點有多台時要指定是哪一台） */
  onSelectMarker: (marker: CctvMarker) => void;
  onSelectFlag: (flag: TrackFlag) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const ticks = useMemo(() => trackTicks(totalKm), [totalKm]);
  const at = (km: number) => (totalKm > 0 ? clamp01(km / totalKm) : 0);
  const pct = `${at(positionKm) * 100}%`;

  const kmAt = useCallback(
    (clientX: number) => {
      const rect = trackRef.current?.getBoundingClientRect();
      if (!rect || rect.width === 0) return positionKm;
      return Math.round(clamp01((clientX - rect.left) / rect.width) * totalKm * 10) / 10;
    },
    [positionKm, totalKm]
  );

  const keyStep = Math.max(0.1, Math.round(totalKm) / 100);
  const onKeyDown = (e: React.KeyboardEvent) => {
    const next =
      e.key === "ArrowRight" || e.key === "ArrowUp"
        ? positionKm + keyStep
        : e.key === "ArrowLeft" || e.key === "ArrowDown"
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

  const prev = stepMarker(markers, activeMarker, -1);
  const next = stepMarker(markers, activeMarker, 1);
  const ordinal = markerOrdinal(markers, activeMarker);
  const kmText = `${positionKm.toFixed(1)} km`;
  const caption =
    markers.length >= 2 && ordinal != null ? (
      <>
        第 <b className="tabular-nums">{ordinal}</b>／{markers.length} 台・{kmText}
      </>
    ) : markers.length === 1 ? (
      `沿途 1 台・${kmText}`
    ) : (
      kmText
    );

  return (
    <div className="space-y-1 pt-1 pb-2">
      <div className="px-4">
        {/* 示警旗標：放在軌道上方，拖曳時不會誤觸 */}
        <div className="relative h-8">
          {flags.map((f) => {
            const selected = activeFlag?.km === f.km;
            return (
              <button
                key={`${f.km}-${f.hazards[0]?.id}`}
                type="button"
                onClick={() => onSelectFlag(f)}
                aria-label={`${f.km.toFixed(1)} km 示警 ${f.hazards.length} 項`}
                aria-pressed={selected}
                className="absolute top-0 flex h-8 w-11 -translate-x-1/2 cursor-pointer flex-col items-center"
                style={{ left: `${at(f.km) * 100}%` }}
              >
                <span
                  className={cn(
                    "flex size-5 items-center justify-center rounded-full text-[11px] font-bold leading-none",
                    FLAG_COLOR[f.level],
                    selected && "ring-4 ring-destructive/20"
                  )}
                  aria-hidden
                >
                  {f.hazards.length > 1 ? f.hazards.length : "!"}
                </span>
                <span className={cn("h-3 w-0.5", f.level === "risky" ? "bg-destructive" : "bg-warning")} aria-hidden />
              </button>
            );
          })}
        </div>

        <div
          ref={trackRef}
          role="slider"
          tabIndex={0}
          aria-label="沿路線位置"
          aria-valuemin={0}
          aria-valuemax={totalKm}
          aria-valuenow={positionKm}
          aria-valuetext={kmText}
          onKeyDown={onKeyDown}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            setDragging(true);
            onMove(kmAt(e.clientX));
          }}
          onPointerMove={(e) => {
            if (dragging) onMove(kmAt(e.clientX));
          }}
          onPointerUp={(e) => {
            if (!dragging) return;
            setDragging(false);
            onMove(snapToMarker(markers, kmAt(e.clientX), totalKm));
          }}
          onPointerCancel={() => setDragging(false)}
          className="relative h-11 cursor-pointer touch-none select-none rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <div className="absolute inset-x-0 top-1/2 h-3 -translate-y-1/2 rounded-full bg-border" aria-hidden />
          <div className="absolute left-0 top-1/2 h-3 -translate-y-1/2 rounded-full bg-primary" style={{ width: pct }} aria-hidden />
          <div
            className={cn(
              "absolute top-1/2 size-[26px] -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-primary bg-card shadow-sm transition-transform",
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
        {markers.length >= 2 ? (
          <button
            type="button"
            onClick={() => prev && onSelectMarker(prev)}
            disabled={!prev}
            aria-label="上一台監視器"
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
        {markers.length >= 2 ? (
          <button
            type="button"
            onClick={() => next && onSelectMarker(next)}
            disabled={!next}
            aria-label="下一台監視器"
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
