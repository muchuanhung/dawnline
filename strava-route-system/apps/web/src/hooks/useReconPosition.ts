"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import type { CctvMarker } from "@/lib/routes/recon-geo";
import { pickActiveMarker } from "@/lib/routes/recon-geo";

/**
 * 路線偵察畫面的游標位置（km）
 * - 初次載入時對齊 initialMarker，使用者操作過就不再自動移動
 * - activeMarker：目前位置對應的主畫面鏡頭；用 selectMarker 指定時以指定的為準
 *   （同一里程有多台鏡頭時，只靠里程分不出是哪一台）
 */
export function useReconPosition(
  routeId: string,
  markers: CctvMarker[],
  initialMarker: CctvMarker | null
) {
  const [positionKm, setPositionKm] = useState(0);
  const [pinnedId, setPinnedId] = useState<string | null>(null);
  const didAutoInitRef = useRef(false);
  const hasUserInteractedRef = useRef(false);

  useEffect(() => {
    didAutoInitRef.current = false;
    hasUserInteractedRef.current = false;
    setPinnedId(null);
  }, [routeId]);

  useEffect(() => {
    if (didAutoInitRef.current || hasUserInteractedRef.current) return;
    if (initialMarker == null) return;
    didAutoInitRef.current = true;
    setPositionKm(initialMarker.km);
  }, [initialMarker]);

  /** 使用者操作（拖曳圖表、點示警、點縮圖）一律走這裡 */
  const moveTo = useCallback((km: number) => {
    hasUserInteractedRef.current = true;
    setPinnedId(null);
    setPositionKm(km);
  }, []);

  /** 指定某一台鏡頭（‹ › 逐台切換） */
  const selectMarker = useCallback((marker: CctvMarker) => {
    hasUserInteractedRef.current = true;
    setPinnedId(marker.id);
    setPositionKm(marker.km);
  }, []);

  const activeMarker = useMemo(() => {
    const pinned = pinnedId ? markers.find((m) => m.id === pinnedId && m.km === positionKm) : undefined;
    return pinned ?? pickActiveMarker(markers, positionKm);
  }, [markers, positionKm, pinnedId]);

  return { positionKm, moveTo, selectMarker, activeMarker };
}
