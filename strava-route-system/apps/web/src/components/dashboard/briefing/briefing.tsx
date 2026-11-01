import { Suspense } from "react";
import { headers } from "next/headers";
import { loadRoutes } from "@/lib/routes/load-routes.server";
import { briefLoadedRoute } from "@/lib/dashboard/get-briefing.server";
import { loadMyRoutes } from "@/lib/dashboard/my-routes.server";
import { loadPrivateRoute } from "@/lib/routes/private-route.server";
import { cachedParsedGpx } from "@/lib/routes/private-gpx-cache.server";
import type { Route } from "@/lib/routes/route-data";
import { BriefingCard } from "./briefing-card";
import { BriefingLoading } from "./briefing-loading";
import { HazardSummary } from "./hazard-summary";
import { RouteSwitcher, type SwitcherRoute } from "./route-switcher";
import { DataNotice } from "@/components/verdict/data-notice";
import { TripSettings } from "@/components/trip/trip-settings";
import {
  activityOfRouteType,
  speedFor,
  type Activity,
  type SpeedPrefs,
  type TripParams,
} from "@/lib/routes/trip";
import { routeTotalKm } from "@/lib/routes/recon-geo";

type Trip = { departure: Date | null; activity: Activity | null; speeds?: SpeedPrefs };

/** 畫面上正在判讀的路線；私人路線由後端讀 GPX 解析（帶使用者 cookie，權限由後端判斷） */
type Current = { route: Route; isPrivate: boolean };

/**
 * 依序嘗試候選 id：公開清單裡有就用；登入時再試私人路線（不是自己的或讀不到就略過）。
 * 全部失敗回 null。
 */
async function resolveCurrent(candidates: (string | undefined)[], routes: Route[], cookie: string | null): Promise<Current | null> {
  for (const id of candidates) {
    if (!id) continue;
    const route = routes.find((r) => r.id === id);
    if (route) return { route, isPrivate: false };
    if (cookie === null) continue;
    try {
      return { route: await loadPrivateRoute(id, cookie, cachedParsedGpx), isPrivate: true };
    } catch {
      // Not the user's route, expired session or backend down: try the next candidate
    }
  }
  return null;
}

/**
 * 今日判讀主體。行程設定與路線切換列只需要路線清單（已快取），先輸出；
 * 判讀卡另外串流。換路線、改出發或運動時只有判讀卡位置顯示載入中，上方設定與切換列不消失。
 */
export async function Briefing({
  routeId,
  trip,
  signedIn = false,
}: {
  routeId?: string;
  /** 網址上的行程設定；null 為未指定（現在出發、依路線類型） */
  trip: Trip;
  /** 已登入：切換列改放收藏與自己的路線（T8），也能判讀私人路線 */
  signedIn?: boolean;
}) {
  const routes = await loadRoutes();
  // 只有登入時才把 cookie 轉給後端；null 代表不嘗試私人路線
  const cookie = signedIn ? ((await headers()).get("cookie") ?? "") : null;
  // null：未登入或讀不到 → 照舊顯示公開路線；[]：登入但還沒有收藏或上傳
  const mine = cookie !== null ? await loadMyRoutes(cookie, new Set(routes.map((r) => r.id))) : null;
  const useMine = Boolean(mine && mine.length > 0);

  const resolved = await resolveCurrent(
    [routeId, useMine ? mine![0]!.id : undefined, routes[0]?.id],
    routes,
    cookie
  );
  if (!resolved) {
    return (
      <section className="rounded-2xl border border-dashed border-border bg-card p-8 text-center">
        <h2 className="text-lg font-bold">目前沒有可判讀的路線</h2>
        <p className="mt-2 text-sm text-muted-foreground">路線資料暫時讀不到，請稍後再回來看看。</p>
      </section>
    );
  }

  const { route: current, isPrivate } = resolved;
  // 名稱規則與 briefRoute 相同（中文名優先）；公開收藏也用解析後的名稱，與未登入時一致
  const displayName = (r: Route) => r.nameZh || r.name;
  const switcherRoutes: SwitcherRoute[] = useMine
    ? mine!.map((r) => {
        const pub = r.visibility === "public" ? routes.find((x) => x.id === r.id) : undefined;
        return { id: r.id, name: pub ? displayName(pub) : r.name, mark: r.source === "favorite" ? "favorite" : "private" };
      })
    : routes.map((r) => ({ id: r.id, name: displayName(r) }));
  // 目前路線不在切換列（例如第 6 條自己的路線）時補在最後，由 RouteSwitcher 換進可見範圍
  if (!switcherRoutes.some((r) => r.id === current.id)) {
    switcherRoutes.push({ id: current.id, name: displayName(current), mark: isPrivate ? "private" : undefined });
  }
  /** 換路線、換頁時帶著的行程設定 */
  const tripParams: TripParams = { depart: trip.departure?.toISOString(), activity: trip.activity };
  // Same defaults as briefRoute, so the settings row can render before the briefing arrives
  const defaultActivity = activityOfRouteType(current.type);
  const activity = trip.activity ?? defaultActivity;
  const speedKmh = speedFor(activity, trip.speeds?.[activity]);

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <TripSettings
          departure={(trip.departure ?? new Date()).toISOString()}
          activity={activity}
          speedKmh={speedKmh}
          defaultActivity={defaultActivity}
          explicitActivity={trip.activity}
          explicitDeparture={trip.departure?.toISOString() ?? null}
          // 均速面板試算用：與判讀同一套 paceFor，需要高程剖面
          speedRoute={{
            totalKm: routeTotalKm(current),
            profile: current.elevationProfile,
            elevationGainM: current.elevationGain,
          }}
        />
        <RouteSwitcher routes={switcherRoutes} currentId={current.id} trip={tripParams} mine={useMine} />
        {mine?.length === 0 && (
          <p className="text-sm text-muted-foreground">
            還沒有收藏或上傳的路線：在路線頁按 ☆ 收藏，或上傳自己的 GPX，這裡就會換成你的路線。
          </p>
        )}
      </div>
      {/* key 換了就是新的判讀：只有這一塊顯示載入中 */}
      <Suspense key={[current.id, tripParams.depart, tripParams.activity, speedKmh].join("|")} fallback={<BriefingLoading />}>
        <BriefingResult route={current} isPrivate={isPrivate} trip={trip} tripParams={tripParams} speedKmh={speedKmh} />
      </Suspense>
    </div>
  );
}

/**
 * 判讀卡與沿途示警：只判讀目前這一條路線（判讀輸入讀 Firestore，由排程每 10 分鐘更新）。
 * 公開與私人路線同一套判讀流程（briefLoadedRoute），差別只在路線來源。
 */
async function BriefingResult({
  route,
  isPrivate,
  trip,
  tripParams,
  speedKmh,
}: {
  route: Route;
  isPrivate: boolean;
  trip: Trip;
  tripParams: TripParams;
  /** 已依運動類型解析的平地均速（自訂或預設） */
  speedKmh: number;
}) {
  const featured = await briefLoadedRoute(route, {
    departure: trip.departure ?? undefined,
    activity: trip.activity ?? undefined,
    speedKmh,
  });
  if (!featured) return null;

  return (
    <div className="space-y-4">
      {/* 桌機左主卡、右沿途示警；手機依序往下 */}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] lg:items-start">
        <BriefingCard featured={featured} trip={tripParams} isPrivate={isPrivate} />
        <HazardSummary briefing={featured} />
      </div>
      <DataNotice generatedAt={featured.generatedAt} />
    </div>
  );
}
