"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { locateOnRoute, type RoutePolylineKm, type RoutePosition } from "@/lib/routes/recon-geo";
import { RIDE_REBRIEF_MAX_AGE_MS, shouldRebrief, type AppliedKm } from "@/lib/routes/ride-position";

/**
 * 途中模式定位：在手機端把高精度定位換算成路線里程；座標不上傳、不儲存，只記里程。
 * 要高精度並檢查精度。
 *
 * - 已授權定位時自動定位：進路線頁、切路線、回到畫面；第一次授權仍要使用者按按鈕（不主動跳權限詢問）。
 * - 途中模式且畫面在前景時持續定位，移動滿 0.5 km 或距上次判讀滿 5 分鐘才重新判讀。
 * - 自動定位不準、不在路線上時不打擾使用者（多半是在家規劃路線）；按按鈕才顯示原因。
 */
export type PositionOnRouteState =
  | { status: "idle" }
  | { status: "locating" }
  | { status: "denied" }
  /** 瀏覽器不支援、逾時或其他定位錯誤 */
  | { status: "unavailable" }
  /** 使用者按「改位置」：在軌道上手動放置 */
  | { status: "placing" }
  | RoutePosition;

/** 定位來源：tap 為使用者按按鈕，auto 為自動單次定位，watch 為途中模式持續定位 */
type FixSource = "tap" | "auto" | "watch";

/** 山區 GPS 第一次收訊慢，逾時放寬到 20 秒；30 秒內的舊定位可直接用 */
const GEO_OPTIONS: PositionOptions = { enableHighAccuracy: true, timeout: 20_000, maximumAge: 30_000 };
/** 持續定位：10 秒內的定位可沿用，省電 */
const WATCH_OPTIONS: PositionOptions = { enableHighAccuracy: true, timeout: 30_000, maximumAge: 10_000 };
/** 站著不動時 watchPosition 可能不回報，另以計時器檢查是否該依時間重新判讀 */
const REFRESH_CHECK_MS = 60_000;

const roundKm = (km: number) => Math.round(km * 10) / 10;

interface Options {
  routeId: string;
  polyline: RoutePolylineKm | null;
  /** 目前是否在途中模式（已有生效里程） */
  riding: boolean;
  /** 套用新的里程（觸發重新判讀） */
  onKm: (km: number) => void;
}

export function usePositionOnRoute({ routeId, polyline, riding, onKm }: Options) {
  const [state, setState] = useState<PositionOnRouteState>({ status: "idle" });
  const { state: permission, markGranted } = useGeolocationPermission();
  const visible = usePageVisible();
  // 上次確定的里程：往返路線同一點對到多次經過時，用來挑「不早於上次」的那一次
  const previousKmRef = useRef<number | undefined>(undefined);
  // 上次觸發判讀的里程與時間，用來節流
  const appliedRef = useRef<AppliedKm | null>(null);
  // 使用者按「整條路線」離開途中模式的路線：本次瀏覽不再自動進入，按定位才恢復
  const dismissedRef = useRef(new Set<string>());
  const routeIdRef = useRef(routeId);
  // 按按鈕定位的請求序號：使用者改走手動放置、離開途中模式或再按一次後，舊的定位結果丟掉
  const locateSeqRef = useRef(0);
  const onKmRef = useRef(onKm);

  useEffect(() => {
    routeIdRef.current = routeId;
    onKmRef.current = onKm;
  }, [routeId, onKm]);

  // 切路線：清掉上一條路線的狀態；自動定位的 effect 會對新路線重新定位
  useEffect(() => {
    previousKmRef.current = undefined;
    appliedRef.current = null;
    setState({ status: "idle" });
  }, [routeId]);

  /** 套用里程：force 為使用者操作或定時刷新，否則依移動距離與時間節流 */
  const apply = useCallback(
    (km: number, force: boolean) => {
      const now = Date.now();
      const rounded = roundKm(km);
      if (!force && !shouldRebrief(appliedRef.current, rounded, now)) return;
      const applied = { km: rounded, at: now };
      appliedRef.current = applied;
      onKmRef.current(rounded);
    },
    []
  );

  const handleFix = useCallback(
    (source: FixSource, coords: GeolocationCoordinates, forRouteId: string) => {
      // 定位回來前已換路線：結果屬於上一條路線，丟掉
      if (forRouteId !== routeIdRef.current) return;
      const result = locateOnRoute(
        { lat: coords.latitude, lon: coords.longitude, accuracyM: coords.accuracy },
        polyline,
        { previousKm: previousKmRef.current }
      );
      if (result.status === "on_route") {
        previousKmRef.current = result.km;
        setState(result);
        apply(result.km, source === "tap");
        return;
      }
      // 按按鈕：所有結果都說明；自動定位：只問往返路線的第幾次經過；持續定位：離開路線要提醒
      if (
        source === "tap" ||
        (source === "auto" && result.status === "ambiguous") ||
        (source === "watch" && result.status === "off_route")
      ) {
        setState(result);
      }
    },
    [polyline, apply]
  );

  // 已授權、畫面在前景、不在途中模式：自動定位一次（進頁面、切路線、回到畫面都會重跑）
  useEffect(() => {
    if (permission !== "granted" || !visible || riding || !polyline) return;
    if (dismissedRef.current.has(routeId) || typeof navigator === "undefined" || !navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => handleFix("auto", coords, routeId),
      () => {
        // 自動定位失敗不打擾，使用者仍可按按鈕
      },
      GEO_OPTIONS
    );
  }, [permission, visible, riding, polyline, routeId, handleFix]);

  // 途中模式且畫面在前景：持續定位；切到背景或鎖屏即停止（網頁無法背景定位）
  useEffect(() => {
    if (permission !== "granted" || !visible || !riding || !polyline) return;
    if (typeof navigator === "undefined" || !navigator.geolocation) return;
    const id = navigator.geolocation.watchPosition(
      ({ coords }) => handleFix("watch", coords, routeId),
      () => {
        // 單次逾時或收訊不佳：保留目前里程，等下一次回報
      },
      WATCH_OPTIONS
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [permission, visible, riding, polyline, routeId, handleFix]);

  // 途中模式且畫面在前景：距上次判讀滿 5 分鐘就用最新里程重新判讀（站著不動時預報與雨量仍會變）
  useEffect(() => {
    if (!visible || !riding) return;
    const timer = setInterval(() => {
      const last = appliedRef.current;
      if (last && Date.now() - last.at >= RIDE_REBRIEF_MAX_AGE_MS) apply(previousKmRef.current ?? last.km, true);
    }, REFRESH_CHECK_MS);
    return () => clearInterval(timer);
  }, [visible, riding, apply]);

  const locate = useCallback(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setState({ status: "unavailable" });
      return;
    }
    dismissedRef.current.delete(routeId);
    const seq = ++locateSeqRef.current;
    setState({ status: "locating" });
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        if (seq !== locateSeqRef.current) return;
        // 不支援 Permissions API 的瀏覽器（舊版 Safari）：定位成功即視為已授權，之後可自動更新
        markGranted();
        handleFix("tap", coords, routeId);
      },
      (err) => {
        if (seq !== locateSeqRef.current || routeIdRef.current !== routeId) return;
        setState({ status: err.code === err.PERMISSION_DENIED ? "denied" : "unavailable" });
      },
      GEO_OPTIONS
    );
  }, [routeId, handleFix, markGranted]);

  /** 使用者手動選定里程（定位不準、往返路線選擇）：直接套用，也記成上次里程 */
  const choose = useCallback(
    (km: number) => {
      locateSeqRef.current++;
      dismissedRef.current.delete(routeId);
      previousKmRef.current = km;
      apply(km, true);
      setState({ status: "idle" });
    },
    [routeId, apply]
  );

  /** 離開途中模式：本次瀏覽不再對這條路線自動進入，按定位才恢復 */
  const dismiss = useCallback(() => {
    locateSeqRef.current++;
    dismissedRef.current.add(routeId);
    appliedRef.current = null;
    setState({ status: "idle" });
  }, [routeId]);

  /** 改位置：不等定位（定位中也可按），直接進入軌道放置模式 */
  const place = useCallback(() => {
    locateSeqRef.current++;
    setState({ status: "placing" });
  }, []);

  /** 取消放置：保留目前生效的里程 */
  const cancelPlace = useCallback(() => {
    setState({ status: "idle" });
  }, []);

  return { state, locate, choose, dismiss, place, cancelPlace };
}

/** 定位權限狀態；不支援 Permissions API 時為 null（只能靠使用者按按鈕） */
function useGeolocationPermission() {
  const [state, setState] = useState<PermissionState | null>(null);

  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.permissions?.query) return;
    let status: PermissionStatus | null = null;
    let cancelled = false;
    navigator.permissions
      .query({ name: "geolocation" })
      .then((s) => {
        if (cancelled) return;
        status = s;
        setState(s.state);
        s.onchange = () => setState(s.state);
      })
      .catch(() => {
        // query 不支援 geolocation：維持 null
      });
    return () => {
      cancelled = true;
      if (status) status.onchange = null;
    };
  }, []);

  const markGranted = useCallback(() => setState("granted"), []);
  return { state, markGranted };
}

function usePageVisible(): boolean {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const update = () => setVisible(document.visibilityState === "visible");
    update();
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  return visible;
}
