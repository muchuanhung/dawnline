"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import {
  BackendError,
  deletePrivateRoute,
  listPrivateRoutes,
  uploadGpx,
  type PrivateRoute,
} from "@/lib/routes/private-routes";

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
export function usePrivateRoutes() {
  const { user, loading: authLoading, refreshSession } = useAuth();
  const [state, setState] = useState<State>({ routes: [], limit: null, loading: true, error: null });

  const withSessionRetry = useCallback(
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

  const refetch = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const { routes, limit } = await withSessionRetry(listPrivateRoutes);
      setState({ routes, limit, loading: false, error: null });
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
