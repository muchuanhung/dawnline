"use client";

import { useEffect, useMemo, useState } from "react";
import type { Route } from "@/lib/routes/route-data";
import type { RoutePolylineKm } from "@/lib/routes/recon-geo";
import { bboxOfPoints, isRadarStale, type Extent, type RadarResponse } from "@/lib/cwb/radar";

/** 頁面開著時重抓的間隔；CWA 每 10 分鐘出一張 */
const REFRESH_MS = 5 * 60 * 1000;

export type RouteRadarState =
  | { status: "loading" }
  | { status: "ready"; data: RadarResponse }
  /** 過期、抓不到、離線或路線不在範圍內：一律顯示「雷達資料暫無」，不放舊圖 */
  | { status: "unavailable" };

/**
 * 路線附近的雷達回波圖（只供顯示，不影響判定）。
 * 以路線 bbox 查詢（私人路線沒有 bbox 時由折線算）；bbox 取到小數 3 位，讓同一條路線命中 CDN 快取。
 */
export function useRouteRadar(route: Route | null, polyline: RoutePolylineKm | null): RouteRadarState {
  const bbox = useMemo<Extent | null>(
    () => route?.bbox ?? (polyline ? bboxOfPoints(polyline.points) : null),
    [route?.bbox, polyline]
  );
  const query = bbox
    ? new URLSearchParams({
        minLon: bbox[0].toFixed(3),
        minLat: bbox[1].toFixed(3),
        maxLon: bbox[2].toFixed(3),
        maxLat: bbox[3].toFixed(3),
      }).toString()
    : null;
  const [state, setState] = useState<RouteRadarState>({ status: "loading" });

  useEffect(() => {
    if (!query) {
      setState({ status: "unavailable" });
      return;
    }
    // 換路線時較晚回來的舊請求不可覆蓋新路線
    let cancelled = false;
    const load = () =>
      fetch(`/api/radar?${query}`)
        .then((res) => (res.ok ? (res.json() as Promise<RadarResponse>) : null))
        .then((data) => {
          if (cancelled) return;
          setState(data && !isRadarStale(data.observedAt) ? { status: "ready", data } : { status: "unavailable" });
        })
        .catch(() => {
          if (!cancelled) setState({ status: "unavailable" });
        });

    setState({ status: "loading" });
    void load();
    const timer = setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [query]);

  return state;
}
