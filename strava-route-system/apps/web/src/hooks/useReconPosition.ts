"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import type { CctvMarker } from "@/lib/routes/recon-geo";
import { pickActiveMarker } from "@/lib/routes/recon-geo";
import type { TrackStop, TrackZone } from "@/lib/routes/route-track";

/**
 * 路線偵察畫面的游標位置（km）
 * - 初次載入時對齊 initialMarker，使用者操作過就不再自動移動
 * - activeMarker：目前位置對應的主畫面鏡頭；用 selectMarker 指定時以指定的為準
 *   （同一里程有多台鏡頭時，只靠里程分不出是哪一台）
 * - activeZone：展開說明中的示警路段；軌道、高程圖、示警列表停到示警路段都走 selectZone，
 *   其他任何移動（拖到鏡頭、途中定位）都會收起，三處看到的停點一致
 */
export function useReconPosition(
  routeId: string,
  markers: CctvMarker[],
  initialMarker: CctvMarker | null,
  zones: TrackZone[] = []
) {
  const [positionKm, setPositionKm] = useState(0);
  const [pinnedId, setPinnedId] = useState<string | null>(null);
  const [openZoneKm, setOpenZoneKm] = useState<number | null>(null);
  const didAutoInitRef = useRef(false);
  const hasUserInteractedRef = useRef(false);

  useEffect(() => {
    didAutoInitRef.current = false;
    hasUserInteractedRef.current = false;
    setPinnedId(null);
    setOpenZoneKm(null);
  }, [routeId]);

  useEffect(() => {
    if (didAutoInitRef.current || hasUserInteractedRef.current) return;
    if (initialMarker == null) return;
    didAutoInitRef.current = true;
    setPositionKm(initialMarker.km);
  }, [initialMarker]);

  /** 使用者操作（沒有停點時的連續拖曳、途中定位）一律走這裡 */
  const moveTo = useCallback((km: number) => {
    hasUserInteractedRef.current = true;
    setPinnedId(null);
    setOpenZoneKm(null);
    setPositionKm(km);
  }, []);

  /** 指定某一台鏡頭（‹ › 逐台切換） */
  const selectMarker = useCallback((marker: CctvMarker) => {
    hasUserInteractedRef.current = true;
    setPinnedId(marker.id);
    setOpenZoneKm(null);
    setPositionKm(marker.km);
  }, []);

  /** 停到示警路段：游標移到路段起點並展開說明 */
  const selectZone = useCallback((zone: TrackZone) => {
    hasUserInteractedRef.current = true;
    setPinnedId(null);
    setOpenZoneKm(zone.startKm);
    setPositionKm(zone.startKm);
  }, []);

  /** 停到任一停點（鏡頭或示警路段） */
  const selectStop = useCallback(
    (stop: TrackStop) => (stop.kind === "marker" ? selectMarker(stop.marker) : selectZone(stop.zone)),
    [selectMarker, selectZone]
  );

  /** 只收起示警說明，游標不動 */
  const closeZone = useCallback(() => setOpenZoneKm(null), []);

  const activeMarker = useMemo(() => {
    const pinned = pinnedId ? markers.find((m) => m.id === pinnedId && m.km === positionKm) : undefined;
    return pinned ?? pickActiveMarker(markers, positionKm);
  }, [markers, positionKm, pinnedId]);

  // 判讀更新後示警路段可能變了，找不到就視同收起
  const activeZone = useMemo(
    () => zones.find((z) => z.hazards.length > 0 && z.startKm === openZoneKm) ?? null,
    [zones, openZoneKm]
  );

  return { positionKm, moveTo, selectMarker, selectZone, selectStop, closeZone, activeMarker, activeZone };
}
