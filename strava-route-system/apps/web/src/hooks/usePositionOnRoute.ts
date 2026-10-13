"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { locateOnRoute, type RoutePolylineKm, type RoutePosition } from "@/lib/routes/recon-geo";
import { RIDE_REBRIEF_MAX_AGE_MS, shouldRebrief, type AppliedKm } from "@/lib/routes/ride-position";
import { clearRideKm, loadRideKm, saveRideKm } from "@/lib/routes/ride-position-storage";

/**
 * 途中模式定位：在手機端把高精度定位換算成路線里程；座標不上傳、不儲存，只記里程。
 * 與 LocationContext 分開：那邊是天氣卡找附近測站用的低精度定位，這裡要高精度並檢查精度。
 *
 * - 已授權定位時自動定位：進路線頁、切路線、回到畫面；第一次授權仍要使用者按按鈕（不主動跳權限詢問）。
 * - 途中模式且畫面在前景時持續定位，移動滿 0.5 km 或距上次判讀滿 5 分鐘才重新判讀。
 * - 每條路線記住上次里程：切回來先顯示，並作為往返路線判斷「第幾次經過」的依據。
 * - 自動定位不準、不在路線上時不打擾使用者（多半是在家規劃路線）；按按鈕才顯示原因。
 */
export type PositionOnRouteState =
  | { status: "idle" }
  | { status: "locating" }
  | { status: "denied" }
  /** 瀏覽器不支援、逾時或其他定位錯誤 */
  | { status: "unavailable" }
  /** 切回路線時套用的上次里程，尚未重新定位；ageMin 為距今分鐘數 */
  | { status: "remembered"; ageMin: number }
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
  totalKm: number;
  /** 目前是否在途中模式（已有生效里程） */
  riding: boolean;
  /** 套用新的里程（觸發重新判讀） */
  onKm: (km: number) => void;
}

export function usePositionOnRoute({ routeId, polyline, totalKm, riding, onKm }: Options) {
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
  const onKmRef = useRef(onKm);

  useEffect(() => {
    routeIdRef.current = routeId;
    onKmRef.current = onKm;
  }, [routeId, onKm]);

  // 切路線：帶回這條路線上次的里程（未過期才用）
  useEffect(() => {
    const now = Date.now();
    const remembered = loadRideKm(routeId, now, totalKm);
    previousKmRef.current = remembered?.km;
    appliedRef.current = remembered;
    if (remembered && !dismissedRef.current.has(routeId)) {
      setState({ status: "remembered", ageMin: Math.round((now - remembered.at) / 60_000) });
      onKmRef.current(remembered.km);
    } else {
      setState({ status: "idle" });
    }
  }, [routeId, totalKm]);

  /** 套用里程：force 為使用者操作或定時刷新，否則依移動距離與時間節流 */
  const apply = useCallback(
    (km: number, force: boolean) => {
      const now = Date.now();
      const rounded = roundKm(km);
      if (!force && !shouldRebrief(appliedRef.current, rounded, now)) return;
      const applied = { km: rounded, at: now };
      appliedRef.current = applied;
      saveRideKm(routeId, applied);
      onKmRef.current(rounded);
    },
    [routeId]
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
    setState({ status: "locating" });
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        // 不支援 Permissions API 的瀏覽器（舊版 Safari）：定位成功即視為已授權，之後可自動更新
        markGranted();
        handleFix("tap", coords, routeId);
      },
      (err) => {
        if (routeIdRef.current !== routeId) return;
        setState({ status: err.code === err.PERMISSION_DENIED ? "denied" : "unavailable" });
      },
      GEO_OPTIONS
    );
  }, [routeId, handleFix, markGranted]);

  /** 使用者手動選定里程（定位不準、往返路線選擇）：直接套用，也記成上次里程 */
  const choose = useCallback(
    (km: number) => {
      dismissedRef.current.delete(routeId);
      previousKmRef.current = km;
      apply(km, true);
      setState({ status: "idle" });
    },
    [routeId, apply]
  );

  /** 離開途中模式：忘掉這條路線的里程，本次瀏覽不再自動進入 */
  const dismiss = useCallback(() => {
    dismissedRef.current.add(routeId);
    clearRideKm(routeId);
    appliedRef.current = null;
    setState({ status: "idle" });
  }, [routeId]);

  /** 畫面開著時會自動更新位置 */
  const tracking = permission === "granted" && visible && riding && polyline != null;

  return { state, tracking, locate, choose, dismiss };
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
