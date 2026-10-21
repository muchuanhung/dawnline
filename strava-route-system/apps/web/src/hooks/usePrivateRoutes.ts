"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import {
  BackendError,
  deletePrivateRoute,
  fetchPrivateRouteDetail,
  listPrivateRoutes,
  uploadGpx,
  warmPrivateSummaries,
  type PrivateRoute,
} from "@/lib/routes/private-routes";
import type { Route } from "@/lib/routes/route-data";

interface State {
  routes: PrivateRoute[];
  limit: number | null;
  loading: boolean;
  error: string | null;
}

/**
 * 私人路線列表、上傳與刪除。
 * 後端 session（rc_session）過期時回 401：重新用 Firebase ID token 換 session 後重試一次。
 */
/** 後端 session 過期（401）時重新換 session 後重試一次；列表與詳情共用 */
function useSessionRetry() {
  const { refreshSession } = useAuth();
  return useCallback(
    async <T,>(fn: () => Promise<T>): Promise<T> => {
      try {
        return await fn();
      } catch (err) {
        if (!(err instanceof BackendError) || err.status !== 401) throw err;
        await refreshSession();
        return fn();
      }
    },
    [refreshSession]
  );
}

export function usePrivateRoutes() {
  const { user, loading: authLoading } = useAuth();
  const [state, setState] = useState<State>({ routes: [], limit: null, loading: true, error: null });
  const withSessionRetry = useSessionRetry();

  const refetch = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const { routes, limit } = await withSessionRetry(listPrivateRoutes);
      setState({ routes, limit, loading: false, error: null });
      // 背景先產生各路線的 AI 句子（伺服器快取），點進路線時不用等
      warmPrivateSummaries(routes);
    } catch (err) {
      setState((s) => ({ ...s, loading: false, error: err instanceof Error ? err.message : "無法載入路線" }));
    }
  }, [withSessionRetry]);

  // 等 AuthContext 換完 session（onAuthStateChanged 完成後 loading 才變 false）再讀列表
  useEffect(() => {
    if (!authLoading && user) refetch();
  }, [authLoading, user, refetch]);

  const upload = useCallback(
    async (file: File) => {
      const route = await withSessionRetry(() => uploadGpx(file));
      setState((s) => ({ ...s, routes: [route, ...s.routes] }));
      warmPrivateSummaries([route]);
      return route;
    },
    [withSessionRetry]
  );

  const remove = useCallback(
    async (id: string) => {
      await withSessionRetry(() => deletePrivateRoute(id));
      setState((s) => ({ ...s, routes: s.routes.filter((r) => r.id !== id) }));
    },
    [withSessionRetry]
  );

  return { ...state, refetch, upload, remove };
}

/**
 * 單一私人路線詳情（已解析成 Route，可直接給偵察畫面用）。
 * 先完成 session 重換，之後同頁的判讀請求（/api/routes/private/briefing）才帶得到有效 cookie。
 */
export function usePrivateRoute(id: string) {
  const { user, loading: authLoading } = useAuth();
  const withSessionRetry = useSessionRetry();
  const [state, setState] = useState<{ route: Route | null; loading: boolean; error: string | null }>({
    route: null,
    loading: true,
    error: null,
  });

  useEffect(() => {
    if (authLoading || !user) return;
    let cancelled = false;
    setState({ route: null, loading: true, error: null });
    withSessionRetry(() => fetchPrivateRouteDetail(id))
      .then((route) => {
        if (!cancelled) setState({ route, loading: false, error: null });
      })
      .catch((err: unknown) => {
        if (!cancelled) setState({ route: null, loading: false, error: err instanceof Error ? err.message : "無法載入路線" });
      });
    return () => {
      cancelled = true;
    };
  }, [id, authLoading, user, withSessionRetry]);

  return state;
}
