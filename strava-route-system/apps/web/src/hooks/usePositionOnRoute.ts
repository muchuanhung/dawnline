"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { locateOnRoute, type RoutePolylineKm, type RoutePosition } from "@/lib/routes/recon-geo";

/**
 * 途中模式定位：按一次取一次高精度定位，在手機端換算成路線里程；座標不上傳、不儲存。
 * 與 LocationContext 分開：那邊是天氣卡找附近測站用的低精度定位，這裡要高精度並檢查精度。
 */
export type PositionOnRouteState =
  | { status: "idle" }
  | { status: "locating" }
  | { status: "denied" }
  /** 瀏覽器不支援、逾時或其他定位錯誤 */
  | { status: "unavailable" }
  | RoutePosition;

/** 山區 GPS 第一次收訊慢，逾時放寬到 20 秒；30 秒內的舊定位可直接用 */
const GEO_OPTIONS: PositionOptions = { enableHighAccuracy: true, timeout: 20_000, maximumAge: 30_000 };

export function usePositionOnRoute(routeId: string, polyline: RoutePolylineKm | null) {
  const [state, setState] = useState<PositionOnRouteState>({ status: "idle" });
  // 上次確定的里程：往返路線同一點對到多次經過時，用來挑「不早於上次」的那一次
  const previousKmRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    setState({ status: "idle" });
    previousKmRef.current = undefined;
  }, [routeId]);

  const locate = useCallback(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setState({ status: "unavailable" });
      return;
    }
    setState({ status: "locating" });
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const result = locateOnRoute(
          { lat: coords.latitude, lon: coords.longitude, accuracyM: coords.accuracy },
          polyline,
          { previousKm: previousKmRef.current }
        );
        if (result.status === "on_route") previousKmRef.current = result.km;
        setState(result);
      },
      (err) => setState({ status: err.code === err.PERMISSION_DENIED ? "denied" : "unavailable" }),
      GEO_OPTIONS
    );
  }, [polyline]);

  /** 使用者手動選定里程（定位不準、往返路線選擇）也記成上次里程 */
  const remember = useCallback((km: number) => {
    previousKmRef.current = km;
  }, []);

  const reset = useCallback(() => setState({ status: "idle" }), []);

  return { state, locate, remember, reset };
}
