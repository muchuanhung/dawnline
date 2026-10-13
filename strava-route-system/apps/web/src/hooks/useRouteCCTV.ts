"use client";

import { useState, useEffect } from "react";
import type { Route } from "@/lib/routes/route-data";
import type { CCTVFeed } from "@/lib/routes/route-data";
import { applyProbeStatuses } from "@/lib/cctv/probe-status";
import { applyDemoCctvStatuses } from "@/lib/routes/demo-route";

/** 補抓鏡頭連線狀態；失敗時回 null，鏡頭維持 unknown */
async function fetchProbeStatuses(ids: string[]): Promise<Record<string, unknown> | null> {
  if (ids.length === 0) return null;
  try {
    const res = await fetch(`/api/cctv/status?ids=${ids.map(encodeURIComponent).join(",")}`);
    if (!res.ok) return null;
    const data = await res.json();
    return data && typeof data.statuses === "object" ? data.statuses : null;
  } catch {
    return null;
  }
}

export function useRouteCCTV(route: Route | null): {
  feeds: CCTVFeed[];
  loading: boolean;
  /** 抓取失敗；與「沿途真的沒有鏡頭」（feeds 為空、error 為 false）區分 */
  error: boolean;
} {
  const [feeds, setFeeds] = useState<CCTVFeed[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    setError(false);
    // 換路線時先清空，避免載入期間顯示上一條路線的鏡頭
    setFeeds([]);
    if (!route?.bbox) return;
    const [minLon, minLat, maxLon, maxLat] = route.bbox;
    // 快速切換路線時，較晚回來的舊請求不可覆蓋新路線的結果
    let cancelled = false;
    setLoading(true);
    fetch(
      `/api/cctv/near-route?minLon=${minLon}&minLat=${minLat}&maxLon=${maxLon}&maxLat=${maxLat}`
    )
      .then((res) => {
        if (!res.ok) throw new Error(`CCTV ${res.status}`);
        return res.json();
      })
      .then((data) => {
        if (Array.isArray(data)) return data;
        if (data?.error) throw new Error(data.error);
        return data.feeds ?? [];
      })
      .then((f: CCTVFeed[]) => {
        if (cancelled) return;
        // 示意路線：不探測，直接套示意狀態，讓 demo 看得到四種狀態燈
        if (route.demo) {
          setFeeds(applyDemoCctvStatuses(f));
          return;
        }
        // 先顯示清單（狀態為 unknown），探測結果回來再更新狀態燈，不讓探測拖慢清單
        setFeeds(f);
        fetchProbeStatuses(f.map((feed) => feed.id)).then((statuses) => {
          if (!cancelled && statuses) setFeeds((prev) => applyProbeStatuses(prev, statuses));
        });
      })
      .catch(() => {
        if (cancelled) return;
        setFeeds([]);
        setError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [route?.id, route?.bbox, route?.demo]);

  return { feeds, loading, error };
}
