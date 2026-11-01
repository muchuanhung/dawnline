"use client";

import { useState, useEffect, useCallback } from "react";
import type { Route } from "@/lib/routes/route-data";

interface UseRoutesFromStorageState {
  routes: Route[];
  loading: boolean;
  error: string | null;
}

/**
 * 從 API 讀取 GPX 路線
 */
export function useRoutesFromStorage(): UseRoutesFromStorageState & {
  refetch: () => Promise<void>;
} {
  const [state, setState] = useState<UseRoutesFromStorageState>({
    routes: [],
    loading: true,
    error: null,
  });

  const fetchRoutes = useCallback(async () => {
    // Refetch keeps the current list on screen (only the first load shows the loading state)
    setState((s) => ({ ...s, loading: s.routes.length === 0, error: null }));
    try {
      const res = await fetch("/api/routes/gpx");
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      const routes: Route[] = await res.json();
      setState({
        routes,
        loading: false,
        error: null,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "無法載入路線";
      setState({
        routes: [],
        loading: false,
        error: msg,
      });
    }
  }, []);

  useEffect(() => {
    fetchRoutes();
  }, [fetchRoutes]);

  return { ...state, refetch: fetchRoutes };
}
