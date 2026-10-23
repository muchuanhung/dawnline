"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Search, SlidersHorizontal, Bike } from "lucide-react";
import Spinner from "@/components/ui/Spinner";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerTrigger } from "@/components/ui/drawer";
import type { Route } from "@/lib/routes/route-data";
import { useRoutesFromStorage } from "@/hooks/useRoutesFromStorage";
import { RoutesLoading } from "@/components/routes/routes-loading";
import { useRouteRecon } from "@/hooks/useRouteRecon";
import { RouteCard } from "@/components/routes/route-card";
import { RoutesTabs } from "@/components/routes/routes-tabs";
import { RouteFilters } from "@/components/routes/route-filters";
import { ALL_TYPES, effectiveTypeFilter, matchesTypeFilter, routeTypesOf } from "@/lib/routes/route-types";
import { RouteStickyBar } from "@/components/routes/route-sticky-bar";
import { RouteReconBody } from "@/components/routes/route-recon-body";
import type { Activity } from "@/lib/routes/trip";

/**
 * 路線（客戶端）：路線清單＋偵察畫面（逐段示警、坡度、CCTV）。
 * 外框由 AppShell 提供；initialRouteId 來自 ?route=，可從 Dashboard 直接連到指定路線。
 */
export function RoutesClient({
  initialRouteId,
  trip,
}: {
  initialRouteId?: string;
  /** 網址上的行程設定（出發時間 ISO、運動類型），未指定為 null */
  trip: { depart: string | null; activity: Activity | null };
}) {
  const { routes, loading, error } = useRoutesFromStorage();
  const [selectedId, setSelectedId] = useState(initialRouteId ?? "");
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState(ALL_TYPES);
  const [mobileListOpen, setMobileListOpen] = useState(false);
  const [drawerLoading, setDrawerLoading] = useState(false);
  const [switchingRoute, setSwitchingRoute] = useState(false);
  // 路線卡：手機往下捲過它後，頂部改顯示懸浮列（路線名＋路線列表）
  const [routeHeaderEl, setRouteHeaderEl] = useState<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!switchingRoute) return;
    const t = setTimeout(() => setSwitchingRoute(false), 400);
    return () => clearTimeout(t);
  }, [switchingRoute, selectedId]);

  useEffect(() => {
    if (mobileListOpen) {
      setDrawerLoading(true);
      const t = setTimeout(() => setDrawerLoading(false), 300);
      return () => clearTimeout(t);
    }
  }, [mobileListOpen]);

  // 離線時頁面外殼來自 SW 快取（不分 ?route=），伺服器帶入的路線可能是上次看的那條；以實際網址為準
  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("route");
    if (fromUrl && fromUrl !== initialRouteId) setSelectedId(fromUrl);
  }, [initialRouteId]);

  // 沒指定或指定的路線不存在時，退回第一條
  useEffect(() => {
    if (routes.length > 0 && !routes.some((r) => r.id === selectedId)) {
      setSelectedId(routes[0]!.id);
    }
  }, [routes, selectedId]);

  const selectedRoute = routes.find((r) => r.id === selectedId) || routes[0];
  // CCTV、途中模式、判讀與判定（與私人路線詳情共用）
  const recon = useRouteRecon(selectedRoute, trip);
  const routeStatus = recon.status;
  // 類型篩選的選項依路線資料產生；選的類型已不在資料裡就退回「全部」
  const routeTypes = routeTypesOf(routes);
  const activeTypeFilter = effectiveTypeFilter(typeFilter, routeTypes);
  const filteredRoutes = routes.filter((r) => {
    const matchesSearch = r.name.toLowerCase().includes(search.toLowerCase()) || r.nameZh.includes(search);
    return matchesSearch && matchesTypeFilter(r.type, activeTypeFilter);
  });

  function handleSelectRoute(id: string) {
    if (id === selectedId) return;
    setSwitchingRoute(true);
    setSelectedId(id);
    setMobileListOpen(false);
    // 同步網址，方便分享與重新整理後停在同一條路線（不觸發伺服器請求）
    window.history.replaceState(null, "", `?route=${encodeURIComponent(id)}`);
  }

  if (loading) {
    return <RoutesLoading />;
  }

  if (error) {
    return (
      <div className="mx-auto flex min-h-[50dvh] max-w-sm flex-col items-center justify-center gap-4 text-center">
        <p className="text-sm text-destructive">{error}</p>
        <p className="text-xs text-muted-foreground">請確認 Firebase Storage 已設定 gpx/routes/ 路徑，並已部署 Storage 規則</p>
      </div>
    );
  }

  if (routes.length === 0) {
    return (
      <div className="mx-auto flex min-h-[50dvh] max-w-sm flex-col items-center justify-center gap-4 text-center">
        <Bike className="size-12 text-muted-foreground/40" aria-hidden />
        <p className="text-sm text-muted-foreground">尚無路線</p>
        <p className="text-xs text-muted-foreground">請在 Firebase Storage 的 gpx/routes/ 資料夾上傳 .gpx 檔案</p>
      </div>
    );
  }

  const cardProps = (route: Route, i: number) => ({
    route,
    isSelected: route.id === selectedId,
    onSelect: handleSelectRoute,
    index: i,
    statusOverride: route.id === selectedRoute?.id ? routeStatus : null,
  });

  return (
    <div className="lg:grid lg:grid-cols-[20rem_minmax(0,1fr)] lg:items-start lg:gap-8">
      {/* 桌機：路線清單固定在畫面上，右側詳情隨頁面捲動 */}
      <aside
        aria-label="路線清單"
        className="hidden overflow-hidden rounded-2xl border border-border bg-card lg:sticky lg:top-24 lg:flex lg:max-h-[calc(100dvh-8rem)] lg:flex-col"
      >
        {/* 桌機：探索／我的路線切換放在清單頂端（切換的是這份清單）；手機在頁面標題下方 */}
        <div className="hidden border-b border-border p-3 lg:block">
          <h1 className="sr-only">路線</h1>
          <RoutesTabs current="explore" className="sm:w-full" />
        </div>
        <div className="border-b border-border p-4">
          <RouteFilters search={search} onSearch={setSearch} types={routeTypes} typeFilter={activeTypeFilter} onFilter={setTypeFilter} />
        </div>
        {/* 側欄只有 max-height，Radix ScrollArea 的 viewport（height: 100%）會撐成內容高度而無法捲動；改用原生捲動 */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="space-y-2 p-3">
            <AnimatePresence mode="popLayout">
              {filteredRoutes.length > 0 ? (
                filteredRoutes.map((route, i) => <RouteCard key={route.id} {...cardProps(route, i)} />)
              ) : (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="py-12 text-center">
                  <Search className="mx-auto mb-3 size-8 text-muted-foreground/30" aria-hidden />
                  <p className="text-sm text-muted-foreground">找不到路線</p>
                  <p className="mt-1 text-xs text-muted-foreground">請調整搜尋或過濾條件</p>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
        <p className="border-t border-border p-3 text-center text-xs text-muted-foreground">
          {filteredRoutes.length} / {routes.length} 條路線
        </p>
      </aside>

      <RouteStickyBar
        anchor={routeHeaderEl}
        route={selectedRoute}
        status={routeStatus}
        onOpenList={() => setMobileListOpen(true)}
      />

      <div className="relative min-w-0 space-y-5">
        {/* 標題與切換只在手機顯示（桌機的切換在左側清單頂端）；窄螢幕整列換行，不讓標題或連結被拆字 */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 lg:hidden">
          <h1 className="mr-auto whitespace-nowrap text-2xl font-black tracking-tight sm:text-3xl">路線</h1>
          <Drawer open={mobileListOpen} onOpenChange={setMobileListOpen}>
            <DrawerTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1.5 lg:hidden">
                <SlidersHorizontal className="size-3.5" aria-hidden />
                路線列表
              </Button>
            </DrawerTrigger>
            <DrawerContent className="max-h-[85vh] border-border bg-card">
              <DrawerHeader className={drawerLoading ? "sr-only" : "pb-2"}>
                <DrawerTitle className="text-foreground">選擇一條路線</DrawerTitle>
              </DrawerHeader>
              <div className="overflow-y-auto px-4 pb-6">
                {drawerLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <Spinner size="lg" dotClassName="bg-primary" />
                  </div>
                ) : (
                  <div className="space-y-3">
                      <RouteFilters search={search} onSearch={setSearch} types={routeTypes} typeFilter={activeTypeFilter} onFilter={setTypeFilter} />
                      <div className="space-y-2">
                        {filteredRoutes.map((route, i) => (
                          <RouteCard key={route.id} {...cardProps(route, i)} />
                        ))}
                      </div>
                  </div>
                )}
              </div>
            </DrawerContent>
          </Drawer>
        </div>
        {/* 與「我的路線」同一層的切換，兩頁位置相同 */}
        <RoutesTabs current="explore" className="lg:hidden" />

        {switchingRoute && (
          <div className="absolute inset-0 z-10 flex items-start justify-center bg-background/80 pt-32 backdrop-blur-sm">
            <Spinner size="lg" dotClassName="bg-primary" />
          </div>
        )}
        <AnimatePresence mode="wait">
          {selectedRoute && (
            <motion.div
              key={selectedRoute.id}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.25 }}
              className="w-full min-w-0 space-y-5"
            >
              <RouteReconBody route={selectedRoute} trip={trip} recon={recon} headerRef={setRouteHeaderEl} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
