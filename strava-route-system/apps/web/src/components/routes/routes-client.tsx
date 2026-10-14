"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Search, SlidersHorizontal, Bike, Footprints, Mountain, Trophy, X } from "lucide-react";
import Spinner from "@/components/ui/Spinner";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerTrigger } from "@/components/ui/drawer";
import { cn } from "@/lib/utils";
import type { Route } from "@/lib/routes/route-data";
import { useRoutesFromStorage } from "@/hooks/useRoutesFromStorage";
import { RoutesLoading } from "@/components/routes/routes-loading";
import { useRouteCCTV } from "@/hooks/useRouteCCTV";
import { useRouteBriefing, verdictOf } from "@/hooks/useRouteBriefing";
import { RouteCard } from "@/components/routes/route-card";
import { RouteHeader, statusOfVerdict } from "@/components/routes/route-header";
import { ReconView } from "@/components/routes/recon-view";
import { TripSettings } from "@/components/trip/trip-settings";
import { RideAhead } from "@/components/routes/ride-ahead";
import { buildRoutePolylineKm, routeTotalKm } from "@/lib/routes/recon-geo";
import { formatClock, type Activity } from "@/lib/routes/trip";

type FilterType = "全部" | "自行車" | "跑步" | "健行" | "雪巴運動";

const FILTERS: { value: FilterType; icon?: React.ComponentType<{ className?: string }> }[] = [
  { value: "全部" },
  { value: "自行車", icon: Bike },
  { value: "跑步", icon: Footprints },
  { value: "健行", icon: Mountain },
  { value: "雪巴運動", icon: Trophy },
];

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
  const [typeFilter, setTypeFilter] = useState<FilterType>("全部");
  const [mobileListOpen, setMobileListOpen] = useState(false);
  const [drawerLoading, setDrawerLoading] = useState(false);
  const [switchingRoute, setSwitchingRoute] = useState(false);
  // 途中模式的目前里程，綁定路線：換路線後自動失效，不會把 A 路線的里程套到 B 路線
  // at：套用時間，同一里程定時重新判讀時用來觸發重抓
  const [ahead, setAhead] = useState<{ routeId: string; km: number; at: number } | null>(null);

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
  const {
    feeds: cctvFeeds,
    loading: cctvLoading,
    error: cctvError,
    offline: cctvOffline,
  } = useRouteCCTV(selectedRoute ?? null);
  const aheadOfRoute = ahead && ahead.routeId === selectedRoute?.id ? ahead : null;
  const aheadKm = aheadOfRoute?.km ?? null;
  const selectedPolyline = useMemo(() => (selectedRoute ? buildRoutePolylineKm(selectedRoute) : null), [selectedRoute]);
  const selectedRouteId = selectedRoute?.id;
  const setAheadKm = useCallback(
    (km: number | null) =>
      setAhead(km != null && selectedRouteId ? { routeId: selectedRouteId, km, at: Date.now() } : null),
    [selectedRouteId]
  );
  // 判定、示警、建議時段全由伺服器算（與 Dashboard 同一流程），前端只顯示
  const briefing = useRouteBriefing(selectedRoute?.id, trip, aheadKm, aheadOfRoute?.at ?? null);
  const verdict = verdictOf(briefing);
  const routeStatus = briefing.briefing ? statusOfVerdict(verdict.level) : null;
  const filteredRoutes = routes.filter((r) => {
    const matchesSearch = r.name.toLowerCase().includes(search.toLowerCase()) || r.nameZh.includes(search);
    const matchesType = typeFilter === "全部" || r.type === typeFilter;
    return matchesSearch && matchesType;
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
        <div className="border-b border-border p-4">
          <RouteFilters search={search} onSearch={setSearch} typeFilter={typeFilter} onFilter={setTypeFilter} />
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

      <div className="relative min-w-0 space-y-5">
        {/* 窄螢幕整列換行，不讓標題或連結被拆字 */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
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
                      <RouteFilters search={search} onSearch={setSearch} typeFilter={typeFilter} onFilter={setTypeFilter} />
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
              <RouteHeader
                route={selectedRoute}
                departureLabel={(() => {
                  const s = briefing.briefing?.departureSuggestion;
                  if (!s) return null;
                  return s.nowIsBest ? "現在" : formatClock(new Date(s.from), new Date());
                })()}
              />
              <ReconView
                route={selectedRoute}
                cctvFeeds={cctvFeeds}
                cctvLoading={cctvLoading}
                cctvError={cctvError}
                cctvOffline={cctvOffline}
                briefing={briefing}
                afterHero={
                  <div className="space-y-3">
                  <RideAhead
                    routeId={selectedRoute.id}
                    polyline={selectedPolyline}
                    totalKm={routeTotalKm(selectedRoute)}
                    fromKm={aheadKm}
                    onChange={setAheadKm}
                  />
                  {/* 途中模式的出發時間是由目前位置反推的，不提供出發時間設定，避免與「現在」矛盾 */}
                  {briefing.briefing && aheadKm == null && (
                    <TripSettings
                      departure={briefing.briefing.departure}
                      activity={briefing.briefing.activity}
                      speedKmh={briefing.briefing.speedKmh}
                      defaultActivity={briefing.briefing.defaultActivity}
                      explicitActivity={trip.activity}
                      explicitDeparture={trip.depart}
                    />
                  )}
                  </div>
                }
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function RouteFilters({
  search,
  onSearch,
  typeFilter,
  onFilter,
}: {
  search: string;
  onSearch: (v: string) => void;
  typeFilter: FilterType;
  onFilter: (v: FilterType) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <input
          type="search"
          aria-label="搜尋路線"
          placeholder="搜尋路線..."
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          className="h-9 w-full rounded-lg border border-input bg-background pl-9 pr-8 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        />
        {search && (
          <button
            type="button"
            onClick={() => onSearch("")}
            aria-label="清除搜尋"
            className="absolute right-2.5 top-1/2 -translate-y-1/2 cursor-pointer text-muted-foreground hover:text-foreground"
          >
            <X className="size-3.5" aria-hidden />
          </button>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map(({ value, icon: Icon }) => (
          <button
            key={value}
            type="button"
            onClick={() => onFilter(value)}
            aria-pressed={typeFilter === value}
            className={cn(
              "inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
              typeFilter === value
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-card text-muted-foreground hover:text-foreground"
            )}
          >
            {Icon && <Icon className="size-3" aria-hidden />}
            {value}
          </button>
        ))}
      </div>
    </div>
  );
}
