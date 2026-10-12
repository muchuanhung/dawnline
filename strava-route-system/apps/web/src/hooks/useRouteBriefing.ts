"use client";

import { useEffect, useState } from "react";
import type { RouteBriefing } from "@/lib/dashboard/briefing";
import type { ReconVerdict } from "@/lib/routes/recon-geo";
import type { RouteEvent } from "@/lib/routes/road-events";
import { withTrip, type TripParams } from "@/lib/routes/trip";

export interface RouteEventsState {
  events: RouteEvent[];
  loading: boolean;
  /** 整體抓取失敗 */
  error: boolean;
  /** 部分縣市取不到；與「沿途沒有事件」區分 */
  failedCounties: string[];
}

export interface RouteBriefingState {
  briefing: RouteBriefing | null;
  loading: boolean;
  error: boolean;
}

/**
 * 單一路線的伺服器端判讀；換路線或行程設定時先清空，避免顯示上一次的判定。
 * fromKm：途中模式的目前里程，只判讀前方；不放進 TripParams，避免位置跟著連結帶到別頁或別條路線。
 */
export function useRouteBriefing(
  routeId: string | null | undefined,
  trip: TripParams = {},
  fromKm: number | null = null
): RouteBriefingState {
  const { depart, activity } = trip;
  const [state, setState] = useState<RouteBriefingState>({ briefing: null, loading: false, error: false });

  useEffect(() => {
    if (!routeId) {
      setState({ briefing: null, loading: false, error: false });
      return;
    }
    let cancelled = false;
    setState({ briefing: null, loading: true, error: false });
    const url = withTrip(`/api/routes/briefing?route=${encodeURIComponent(routeId)}`, { depart, activity });
    fetch(fromKm != null ? `${url}&from=${fromKm.toFixed(2)}` : url)
      .then((res) => {
        if (!res.ok) throw new Error(`路線判讀 ${res.status}`);
        return res.json() as Promise<RouteBriefing>;
      })
      .then((briefing) => {
        if (!cancelled) setState({ briefing, loading: false, error: false });
      })
      .catch(() => {
        if (!cancelled) setState({ briefing: null, loading: false, error: true });
      });
    return () => {
      cancelled = true;
    };
  }, [routeId, depart, activity, fromKm]);

  return state;
}

/** 判讀尚未回來或取不到時的顯示用判定：一律未判定，不可顯示安全 */
export function verdictOf({ briefing, loading }: RouteBriefingState): ReconVerdict {
  if (briefing) return briefing.verdict;
  if (loading) return { level: "unknown", reasons: [], headline: "判讀中…", note: "" };
  return { level: "unknown", reasons: ["no_data"], headline: "判讀暫時取不到", note: "請稍後再試。" };
}

/** 沿途路況事件狀態（示警清單用），由伺服器判讀結果轉出 */
export function roadEventsOf({ briefing, loading, error }: RouteBriefingState): RouteEventsState {
  return {
    events: briefing?.roadEvents ?? [],
    loading,
    error: error || briefing?.eventsFailed === null,
    failedCounties: briefing?.eventsFailed ?? [],
  };
}
