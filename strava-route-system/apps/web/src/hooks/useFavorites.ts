"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useSessionRetry } from "@/hooks/usePrivateRoutes";
import { addFavorite, applyFavorite, favoriteErrorMessage, listFavorites, removeFavorite } from "@/lib/routes/favorites";

export interface Favorites {
  /** 未登入（星號導去登入頁） */
  guest: boolean;
  /** 已登入且後端 session 換好；登入中但 session 還沒好時 guest 與 signedIn 都是 false */
  signedIn: boolean;
  /** 收藏的路線 id，新的在前 */
  ids: string[];
  isFavorite: (id: string) => boolean;
  toggle: (id: string) => void;
  /** 最近一次收藏失敗的訊息；成功或再按一次時清掉 */
  error: string | null;
}

/**
 * 我的收藏：登入後讀一次，星號切換時樂觀更新，失敗就改回來並給一句錯誤。
 * 同一條路線連按時以最後一次為準（後端 PUT／DELETE 冪等）。
 */
export function useFavorites(): Favorites {
  const { user, sessionReady } = useAuth();
  const withSessionRetry = useSessionRetry();
  const [ids, setIds] = useState<string[]>([]);
  const [limit, setLimit] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 每條路線最後一次操作的序號：舊請求晚回來時不覆蓋新狀態
  const seq = useRef(new Map<string, number>());
  const signedIn = Boolean(user && sessionReady);

  useEffect(() => {
    if (!signedIn) {
      setIds([]);
      return;
    }
    let cancelled = false;
    withSessionRetry(listFavorites)
      .then(({ favorites, limit }) => {
        if (cancelled) return;
        setIds(favorites.map((f) => f.id));
        setLimit(limit);
      })
      // 讀不到收藏不擋路線頁，只是星號都是空的
      .catch((err) => console.warn("收藏讀取失敗:", err instanceof Error ? err.message : err));
    return () => {
      cancelled = true;
    };
  }, [signedIn, withSessionRetry]);

  const toggle = useCallback(
    (id: string) => {
      if (!signedIn) return;
      const on = !ids.includes(id);
      const mine = (seq.current.get(id) ?? 0) + 1;
      seq.current.set(id, mine);
      setError(null);
      setIds((prev) => applyFavorite(prev, id, on));
      withSessionRetry(() => (on ? addFavorite(id) : removeFavorite(id))).catch((err) => {
        if (seq.current.get(id) !== mine) return;
        setIds((prev) => applyFavorite(prev, id, !on));
        setError(favoriteErrorMessage(err, limit));
      });
    },
    [signedIn, ids, limit, withSessionRetry]
  );

  const isFavorite = useCallback((id: string) => ids.includes(id), [ids]);

  return { guest: !user, signedIn, ids, isFavorite, toggle, error };
}
