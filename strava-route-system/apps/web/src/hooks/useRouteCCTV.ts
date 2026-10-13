"use client";

import { useState, useEffect } from "react";
import type { Route } from "@/lib/routes/route-data";
import type { CCTVFeed } from "@/lib/routes/route-data";

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
        if (!cancelled) setFeeds(f);
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
  }, [route?.id, route?.bbox]);

  return { feeds, loading, error };
}
