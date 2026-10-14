"use client";

import { useState, useEffect } from "react";
import type { Route } from "@/lib/routes/route-data";
import type { CCTVFeed } from "@/lib/routes/route-data";
import { snapshotAtOf } from "@/lib/routes/snapshot";

export function useRouteCCTV(route: Route | null): {
  feeds: CCTVFeed[];
  loading: boolean;
  /** 抓取失敗；與「沿途真的沒有鏡頭」（feeds 為空、error 為 false）區分 */
  error: boolean;
  /** 離線：清單來自 SW 快照或網路失敗；即時影像播不了，與「載入失敗」區分 */
  offline: boolean;
} {
  const [feeds, setFeeds] = useState<CCTVFeed[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    setError(false);
    setOffline(false);
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
        // 快照清單仍可在軌道標出鏡頭位置，但影像要標離線
        if (!cancelled && snapshotAtOf(res.headers) != null) setOffline(true);
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
      .catch((err: unknown) => {
        if (cancelled) return;
        setFeeds([]);
        // fetch 因網路失敗 reject 時是 TypeError（SW 也沒有這條路線的快照）
        if (err instanceof TypeError) setOffline(true);
        else setError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [route?.id, route?.bbox]);

  return { feeds, loading, error, offline };
}
