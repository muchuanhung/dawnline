"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CctvMarker, VerdictLevel } from "@/lib/routes/recon-geo";
import {
  markerOrdinal,
  nearestStop,
  stepStop,
  stopKey,
  trackStops,
  trackTicks,
  zoneAt,
  zonesForPaint,
  type TrackStop,
  type TrackZone,
} from "@/lib/routes/route-track";

/** 路況色段：紅＝危險、橘＝注意、綠＝安全；未判定用斜線，與「安全」明顯區隔 */
const ZONE_FILL: Record<VerdictLevel, string> = {
  risky: "bg-destructive",
  caution: "bg-warning",
  clear: "bg-success",
  unknown: "bg-muted-foreground/25",
};
const UNKNOWN_HATCH = {
  backgroundImage:
    "repeating-linear-gradient(135deg, var(--muted-foreground) 0 2px, transparent 2px 6px)",
  opacity: 0.45,
};
const ZONE_WORD = { risky: "危險", caution: "注意" } as const;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/**
 * 里程軌道：軌道本身就是路況條（綠安全、橘注意、紅危險、斜線未判定），上面一顆拇指點。
 * 拖曳與 ‹ › 只停在鏡頭與示警路段的起點（停點），中間的公里數不停；停到示警路段時展開說明。
 * 示警再密也只是一段顏色，不會被拇指蓋住。沒有任何停點的路線才連續拖曳。
 * 只標整數刻度、不畫鏡頭刻度（見 lib/routes/route-track）。
 */
export function RouteTrack({
  totalKm,
  positionKm,
  markers,
  activeMarker,
  zones,
  activeZone,
  onMove,
  onSelectMarker,
  onSelectZone,
}: {
  totalKm: number;
  positionKm: number;
  markers: CctvMarker[];
  activeMarker: CctvMarker | null;
  /** 路況色段（見 trackZones） */
  zones: TrackZone[];
  /** 展開說明中的示警路段 */
  activeZone: TrackZone | null;
  /** 沒有停點時的連續拖曳、鍵盤移動 */
  onMove: (km: number) => void;
  /** 停到鏡頭（同一點有多台時要指定是哪一台） */
  onSelectMarker: (marker: CctvMarker) => void;
  /** 停到示警路段 */
  onSelectZone: (zone: TrackZone) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const ticks = useMemo(() => trackTicks(totalKm), [totalKm]);
  const stops = useMemo(() => trackStops(markers, zones), [markers, zones]);
  const at = (km: number) => (totalKm > 0 ? clamp01(km / totalKm) : 0);
  const pct = `${at(positionKm) * 100}%`;

  // 目前停在哪個停點：展開中的示警路段優先，其次是剛好停在該里程的鏡頭
  const current: TrackStop | null = activeZone
    ? { kind: "zone", km: activeZone.startKm, zone: activeZone }
    : activeMarker && activeMarker.km === positionKm
      ? { kind: "marker", km: activeMarker.km, marker: activeMarker }
      : null;
  const currentKey = current ? stopKey(current) : null;

  const selectStop = (stop: TrackStop) => {
    if (stop.kind === "marker") onSelectMarker(stop.marker);
    else onSelectZone(stop.zone);
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
  // 一般路段沒有資料時要講明「未判定」，不能讓沒上色被當成安全
  const unknownHere = zoneAt(zones, positionKm)?.level === "unknown";
  const zoneText =
    current?.kind === "zone"
      ? `${ZONE_WORD[current.zone.level as keyof typeof ZONE_WORD] ?? "示警"}路段 ${current.zone.startKm.toFixed(1)}–${current.zone.endKm.toFixed(1)} km・示警 ${current.zone.hazards.length} 項`
      : null;
  const caption = zoneText ? (
    <span className={cn("font-medium", current?.kind === "zone" && current.zone.level === "risky" && "text-destructive")}>
      {zoneText}
    </span>
  ) : (
    <>
      {markers.length >= 2 && ordinal != null ? (
        <>
          第 <b className="tabular-nums">{ordinal}</b>／{markers.length} 台・{kmText}
        </>
      ) : markers.length === 1 ? (
        `沿途 1 台・${kmText}`
      ) : (
        kmText
      )}
      {unknownHere && <span className="text-muted-foreground">・此段未判定</span>}
    </>
  );
  const valueText = zoneText ?? (unknownHere ? `${kmText}，此段未判定` : kmText);

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
          {/* 軌道本身就是路況條；沒有色段的地方（判讀未回來、途中已走過）只留底色 */}
          <div className="absolute inset-x-0 top-1/2 h-3.5 -translate-y-1/2 overflow-hidden rounded-full bg-border" aria-hidden>
            {zonesForPaint(zones).map((z) => (
              <span
                key={`${z.level}-${z.startKm}`}
                className={cn("absolute inset-y-0", ZONE_FILL[z.level])}
                style={{
                  left: `${at(z.startKm) * 100}%`,
                  width: `${(at(z.endKm) - at(z.startKm)) * 100}%`,
                  ...(z.level === "unknown" ? UNKNOWN_HATCH : undefined),
                }}
              />
            ))}
          </div>
          <div
            className={cn(
              "absolute top-1/2 size-7 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-foreground bg-card shadow-md transition-transform",
              dragging && "scale-110 ring-8 ring-foreground/10"
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
