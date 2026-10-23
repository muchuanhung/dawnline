"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { listCardStatus, type CardStatus, type RouteStatusEntry } from "@/lib/routes/route-statuses";
import { SNAPSHOT_MAX_AGE_MS } from "@/lib/routes/snapshot";

/** 與詳情判讀（useRouteBriefing）同一組時間：回前景超過 10 分鐘重抓、過期前 1 分鐘重抓、每 30 秒重算過期 */
const REFRESH_ON_RETURN_MS = 10 * 60_000;
const REFRESH_BEFORE_EXPIRY_MS = 60_000;
const TICK_MS = 30_000;

/**
 * 路線清單每張卡片的判讀標籤（所有公開路線，預設行程）。
 * 回傳 id → 卡片標籤；還沒取得或取不到為 undefined，卡片不顯示標籤（不當成安全）。
 * 取不到時沿用上一份，超過 30 分鐘後「安全」改為未判定（規則見 route-statuses.ts）。
 */
export function useRouteStatuses(): (routeId: string) => CardStatus | undefined {
  const [data, setData] = useState<{ entries: Map<string, RouteStatusEntry>; at: number } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [reload, setReload] = useState(0);
  const atRef = useRef<number | null>(null);
  atRef.current = data?.at ?? null;

  useEffect(() => {
    let cancelled = false;
    fetch("/api/routes/statuses")
      .then((res) => {
        if (!res.ok) throw new Error(`路線清單判讀 ${res.status}`);
        return res.json() as Promise<RouteStatusEntry[]>;
      })
      .then((list) => {
        if (!cancelled) setData({ entries: new Map(list.map((e) => [e.id, e])), at: Date.now() });
      })
      // 失敗就沿用上一份（沒有就不顯示標籤）；過期規則照常運作
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [reload]);

  const refresh = useCallback(() => setReload((n) => n + 1), []);

  // 回到前景：清單太舊或還沒取到就重抓一次
  useEffect(() => {
    const onReturn = () => {
      if (document.visibilityState !== "visible") return;
      const t = Date.now();
      setNow(t);
      if (atRef.current == null || t - atRef.current >= REFRESH_ON_RETURN_MS) refresh();
    };
    document.addEventListener("visibilitychange", onReturn);
    window.addEventListener("pageshow", onReturn);
    return () => {
      document.removeEventListener("visibilitychange", onReturn);
      window.removeEventListener("pageshow", onReturn);
    };
  }, [refresh]);

  // 前景不動：過期前重抓一次；並定時重算現在時間，過期不必等下一次請求
  const at = data?.at ?? null;
  useEffect(() => {
    if (at == null) return;
    setNow(Date.now());
    const tick = setInterval(() => setNow(Date.now()), TICK_MS);
    const delay = Math.max(0, at + SNAPSHOT_MAX_AGE_MS - REFRESH_BEFORE_EXPIRY_MS - Date.now());
    const timer = setTimeout(() => {
      if (document.visibilityState === "visible") refresh();
    }, delay);
    return () => {
      clearInterval(tick);
      clearTimeout(timer);
    };
  }, [at, refresh]);

  return (routeId) => {
    const entry = data?.entries.get(routeId);
    return entry && data ? listCardStatus(entry.level, data.at, now) : undefined;
  };
}
