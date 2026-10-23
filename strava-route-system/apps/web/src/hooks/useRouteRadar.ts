"use client";

import { useEffect, useMemo, useState } from "react";
import type { Route } from "@/lib/routes/route-data";
import type { RoutePolylineKm } from "@/lib/routes/recon-geo";
import {
  bboxOfPoints,
  isInRadarExtent,
  isRadarStale,
  type Extent,
  type RadarFrame,
  type RadarManifest,
} from "@/lib/cwb/radar";

/** 頁面開著時重抓清單的間隔；CWA 每 10 分鐘出一張 */
const REFRESH_MS = 5 * 60 * 1000;

export interface RouteRadar {
  /** 可回放的圖，舊到新：過去 1 小時觀測，最後可能接一張未來 1 小時預報（nowcast） */
  frames: RadarFrame[];
  /** 鄉鎮界（RADAR_VIEW 座標） */
  towns: string;
  /** 路線範圍，取景用 */
  routeBox: Extent;
}

export type RouteRadarState =
  | { status: "loading" }
  | { status: "ready"; data: RouteRadar }
  /** 過期、抓不到、離線或路線不在範圍內：一律顯示「雷達資料暫無」，不放舊圖 */
  | { status: "unavailable" };

export function radarFrameUrl(frame: RadarFrame): string {
  return `/api/radar/frame?id=${frame.id}`;
}

/** 最新一張觀測（預報之前那張） */
export function latestObserved(frames: RadarFrame[]): RadarFrame | null {
  for (let i = frames.length - 1; i >= 0; i--) if (!frames[i]!.nowcast) return frames[i]!;
  return null;
}

/** 鄉鎮界內容固定，整個頁面只抓一次；失敗就不畫底圖，雷達照常顯示 */
let basemap: Promise<string> | null = null;
function loadBasemap(): Promise<string> {
  basemap ??= fetch("/api/radar/basemap")
    .then((res) => (res.ok ? (res.json() as Promise<{ towns: string }>) : { towns: "" }))
    .then((b) => b.towns)
    .catch(() => {
      basemap = null;
      return "";
    });
  return basemap;
}

/**
 * 雷達回波回放（只供顯示，不影響判定）。
 * 清單與路線無關，全站共用同一個 CDN 快取；路線範圍只用來判斷在不在圖內與取景。
 */
export function useRouteRadar(route: Route | null, polyline: RoutePolylineKm | null): RouteRadarState {
  const bbox = useMemo<Extent | null>(
    () => route?.bbox ?? (polyline ? bboxOfPoints(polyline.points) : null),
    [route?.bbox, polyline]
  );
  const inRange = bbox != null && isInRadarExtent(bbox);
  const [state, setState] = useState<{ frames: RadarFrame[]; towns: string } | "loading" | "unavailable">("loading");

  useEffect(() => {
    if (!inRange) {
      setState("unavailable");
      return;
    }
    let cancelled = false;
    const load = () =>
      Promise.all([
        fetch("/api/radar").then((res) => (res.ok ? (res.json() as Promise<RadarManifest>) : null)),
        loadBasemap(),
      ])
        .then(([manifest, towns]) => {
          if (cancelled) return;
          const latest = manifest?.frames.at(-1);
          if (!manifest || !latest || isRadarStale(latest.observedAt)) return setState("unavailable");
          // 預報過期就不接，只放觀測
          const nowcast = manifest.nowcast && !isRadarStale(manifest.nowcast.issuedAt) ? manifest.nowcast : null;
          setState({
            frames: nowcast
              ? [...manifest.frames, { id: nowcast.id, observedAt: nowcast.issuedAt, nowcast: true }]
              : manifest.frames,
            towns,
          });
        })
        .catch(() => {
          if (!cancelled) setState("unavailable");
        });

    void load();
    const timer = setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [inRange]);

  return useMemo<RouteRadarState>(() => {
    if (!inRange || state === "unavailable") return { status: "unavailable" };
    if (state === "loading") return { status: "loading" };
    return { status: "ready", data: { ...state, routeBox: bbox! } };
  }, [inRange, state, bbox]);
}
