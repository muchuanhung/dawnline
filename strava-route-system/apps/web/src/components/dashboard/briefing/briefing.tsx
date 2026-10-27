import { Suspense } from "react";
import { loadRoutes } from "@/lib/routes/load-routes.server";
import { getRouteBriefing } from "@/lib/dashboard/get-briefing.server";
import { BriefingCard } from "./briefing-card";
import { BriefingLoading } from "./briefing-loading";
import { HazardSummary } from "./hazard-summary";
import { RouteSwitcher } from "./route-switcher";
import { TripSettings } from "@/components/trip/trip-settings";
import {
  activityOfRouteType,
  profileAscentM,
  speedFor,
  type Activity,
  type SpeedPrefs,
  type TripParams,
} from "@/lib/routes/trip";
import { routeTotalKm } from "@/lib/routes/recon-geo";

type Trip = { departure: Date | null; activity: Activity | null; speeds?: SpeedPrefs };

/**
 * 今日判讀主體。行程設定與路線切換列只需要路線清單（已快取），先輸出；
 * 判讀卡另外串流。換路線、改出發或運動時只有判讀卡位置顯示載入中，上方設定與切換列不消失。
 */
export async function Briefing({
  routeId,
  trip,
}: {
  routeId?: string;
  /** 網址上的行程設定；null 為未指定（現在出發、依路線類型） */
  trip: Trip;
}) {
  const routes = await loadRoutes();
  if (routes.length === 0) {
    return (
      <section className="rounded-2xl border border-dashed border-border bg-card p-8 text-center">
        <h2 className="text-lg font-bold">目前沒有可判讀的路線</h2>
        <p className="mt-2 text-sm text-muted-foreground">路線資料尚未建立，請稍後再回來看看。</p>
      </section>
    );
  }

  const current = routes.find((r) => r.id === routeId) ?? routes[0]!;
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
          // 只傳距離與總爬升（不傳整條高程剖面），均速面板試算用
          speedRoute={{
            totalKm: routeTotalKm(current),
            ascentM: profileAscentM(current.elevationProfile),
            elevationGainM: current.elevationGain,
          }}
        />
        {/* 名稱規則與 briefRoute 相同（中文名優先） */}
        <RouteSwitcher
          routes={routes.map((r) => ({ id: r.id, name: r.nameZh || r.name }))}
          currentId={current.id}
          trip={tripParams}
        />
      </div>
      {/* key 換了就是新的判讀：只有這一塊顯示載入中 */}
      <Suspense key={[current.id, tripParams.depart, tripParams.activity, speedKmh].join("|")} fallback={<BriefingLoading />}>
        <BriefingResult routeId={current.id} trip={trip} tripParams={tripParams} speedKmh={speedKmh} />
      </Suspense>
    </div>
  );
}

/** 判讀卡與沿途示警：只判讀目前這一條路線（判讀輸入讀 Firestore，由排程每 10 分鐘更新） */
async function BriefingResult({
  routeId,
  trip,
  tripParams,
  speedKmh,
}: {
  routeId: string;
  trip: Trip;
  tripParams: TripParams;
  /** 已依運動類型解析的平地均速（自訂或預設） */
  speedKmh: number;
}) {
  const featured = await getRouteBriefing(routeId, {
    departure: trip.departure ?? undefined,
    activity: trip.activity ?? undefined,
    speedKmh,
  });
  if (!featured) return null;

  return (
    // 桌機左主卡、右沿途示警；手機依序往下
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] lg:items-start">
      <BriefingCard featured={featured} trip={tripParams} />
      <HazardSummary briefing={featured} />
    </div>
  );
}
