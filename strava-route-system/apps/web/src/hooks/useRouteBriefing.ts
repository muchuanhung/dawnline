"use client";

import { useEffect, useRef, useState } from "react";
import type { RouteBriefing } from "@/lib/dashboard/briefing";
import type { ReconVerdict } from "@/lib/routes/recon-geo";
import type { RouteEvent } from "@/lib/routes/road-events";
import { withTrip, type TripParams } from "@/lib/routes/trip";
import { expireVerdict, isSnapshotExpired, snapshotAtOf } from "@/lib/routes/snapshot";

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
  /**
   * 離線快照：網路失敗時顯示的是之前存下的判讀（SW 快取或畫面上的上一份）；線上取得為 null。
   * savedAt 為資料取得時間（epoch ms），expired 為超過 SNAPSHOT_MAX_AGE_MS；now 為最近一次重算的時間（每 30 秒），畫面顯示「幾分鐘前」用。
   */
  snapshot: { savedAt: number; expired: boolean; now: number } | null;
  /**
   * 判讀資料超過 SNAPSHOT_MAX_AGE_MS（線上與快照都算）；過期後「安全」改為未判定。
   * 線上取得的判讀以收到回應的時間起算。
   */
  expired: boolean;
}

/** 過期要隨時間重算，不用等下一次請求 */
const SNAPSHOT_TICK_MS = 30_000;

/** 頁面回到前景時，判讀超過這個時間就重抓一次；不做持續輪詢 */
const REFRESH_ON_RETURN_MS = 10 * 60_000;

/** dataAt：判讀資料的時間（快照為存檔時間，線上為收到回應的時間），過期判斷用 */
type FetchState = Omit<RouteBriefingState, "snapshot" | "expired"> & { savedAt: number | null; dataAt: number | null };

const EMPTY: FetchState = { briefing: null, loading: false, error: false, savedAt: null, dataAt: null };

/**
 * 單一路線的伺服器端判讀；換路線或行程設定時先清空，避免顯示上一次的判定。
 * fromKm：途中模式的目前里程，只判讀前方；不放進 TripParams，避免位置跟著連結帶到別頁或別條路線。
 * refreshAt：途中模式套用里程的時間；里程沒變但時間變了（定時刷新）也要重抓，因為 ETA 以現在起算。
 * 途中模式中只有里程或 refreshAt 改變時，重抓期間保留上一次判讀，避免騎乘中畫面每 0.5 km 閃一次載入。
 *
 * 離線：網路失敗時（fetch reject）沿用 SW 快取（回應帶快照標頭）或畫面上同一路線、同一行程設定的上一份判讀，
 * 標成快照而不是清空；伺服器錯誤（非 2xx）仍視為取不到，不拿舊資料頂替。
 *
 * 回前景：頁面從背景回來（iOS 鎖屏、切分頁、bfcache 還原）時，判讀超過 10 分鐘或上次失敗就重抓一次，
 * 重抓期間保留畫面上的判讀；超過 30 分鐘沒更新的線上判讀一樣套過期規則（未判定 ≠ 安全）。
 *
 * endpoint：判讀 API；私人路線用 /api/routes/private/briefing（參數相同）。
 */
export function useRouteBriefing(
  routeId: string | null | undefined,
  trip: TripParams = {},
  fromKm: number | null = null,
  refreshAt: number | null = null,
  endpoint = "/api/routes/briefing"
): RouteBriefingState {
  const { depart, activity } = trip;
  const [state, setState] = useState<FetchState>(EMPTY);
  const tripKeyRef = useRef<string | null>(null);
  // 上一份成功取得的判讀；key 不含里程，途中模式里程變了仍可沿用
  const lastGoodRef = useRef<{ key: string; briefing: RouteBriefing; savedAt: number } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  // 回前景重抓的觸發計數；只放進抓取 effect 的依賴
  const [reload, setReload] = useState(0);
  // 回前景時讀目前狀態用，避免事件監聽隨狀態重綁
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    if (!routeId) {
      setState(EMPTY);
      return;
    }
    let cancelled = false;
    // 進出途中模式也算換判讀範圍（整條 vs 前方），要清空
    const tripKey = `${routeId}|${depart ?? ""}|${activity ?? ""}|${fromKm != null}`;
    const dataKey = `${routeId}|${depart ?? ""}|${activity ?? ""}`;
    const keep = tripKeyRef.current === tripKey;
    tripKeyRef.current = tripKey;
    setState((s) => ({
      briefing: keep ? s.briefing : null,
      loading: true,
      error: false,
      savedAt: keep ? s.savedAt : null,
      dataAt: keep ? s.dataAt : null,
    }));
    const url = withTrip(`${endpoint}?route=${encodeURIComponent(routeId)}`, { depart, activity });
    fetch(fromKm != null ? `${url}&from=${fromKm.toFixed(2)}` : url)
      .then(async (res) => {
        if (!res.ok) throw new Error(`路線判讀 ${res.status}`);
        return { briefing: (await res.json()) as RouteBriefing, savedAt: snapshotAtOf(res.headers) };
      })
      .then(({ briefing, savedAt }) => {
        lastGoodRef.current = { key: dataKey, briefing, savedAt: savedAt ?? Date.now() };
        if (!cancelled) setState({ briefing, loading: false, error: false, savedAt, dataAt: savedAt ?? Date.now() });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const last = lastGoodRef.current;
        // fetch 因網路失敗 reject 時是 TypeError；SW 沒有快照時也會走到這裡
        if (err instanceof TypeError && last?.key === dataKey) {
          setState({ briefing: last.briefing, loading: false, error: false, savedAt: last.savedAt, dataAt: last.savedAt });
        } else {
          setState({ ...EMPTY, error: true });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [routeId, depart, activity, fromKm, refreshAt, endpoint, reload]);

  // 回到前景：先更新現在時間（背景中計時器會被節流），判讀太舊或上次失敗就重抓一次
  useEffect(() => {
    if (!routeId) return;
    const onReturn = () => {
      if (document.visibilityState !== "visible") return;
      const t = Date.now();
      setNow(t);
      const { loading, error, dataAt } = stateRef.current;
      if (loading) return;
      if (error || (dataAt != null && t - dataAt >= REFRESH_ON_RETURN_MS)) setReload((n) => n + 1);
    };
    document.addEventListener("visibilitychange", onReturn);
    window.addEventListener("pageshow", onReturn);
    return () => {
      document.removeEventListener("visibilitychange", onReturn);
      window.removeEventListener("pageshow", onReturn);
    };
  }, [routeId]);

  // 有判讀期間定時更新現在時間，讓過期規則不必等到下一次請求
  const { savedAt, dataAt } = state;
  useEffect(() => {
    if (dataAt == null) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), SNAPSHOT_TICK_MS);
    return () => clearInterval(timer);
  }, [dataAt]);

  const { briefing, loading, error } = state;
  const expired = briefing != null && dataAt != null && isSnapshotExpired(dataAt, now);
  return {
    briefing,
    loading,
    error,
    snapshot: briefing && savedAt != null ? { savedAt, expired, now } : null,
    expired,
  };
}

/** 判讀尚未回來或取不到時的顯示用判定：一律未判定，不可顯示安全 */
export function verdictOf({ briefing, loading, snapshot, expired }: RouteBriefingState): ReconVerdict {
  // 過期判讀（離線快照或線上太久沒更新）：安全改為未判定，已知示警保留但加註（規則見 snapshot.ts）
  if (briefing) return expired ? expireVerdict(briefing.verdict, snapshot != null) : briefing.verdict;
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
