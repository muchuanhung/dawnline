import { getDashboardBriefing } from "@/lib/dashboard/get-briefing.server";
import { BriefingCard } from "./briefing-card";
import { HazardSummary } from "./hazard-summary";
import { RouteSwitcher } from "./route-switcher";
import { TripSettings } from "@/components/trip/trip-settings";
import type { Activity, TripParams } from "@/lib/routes/trip";

/** 今日判讀主體：在伺服器端取得路線與天氣後一次輸出 */
export async function Briefing({
  routeId,
  trip,
}: {
  routeId?: string;
  /** 網址上的行程設定；null 為未指定（現在出發、依路線類型） */
  trip: { departure: Date | null; activity: Activity | null };
}) {
  const data = await getDashboardBriefing(routeId, {
    departure: trip.departure ?? undefined,
    activity: trip.activity ?? undefined,
  });

  if (data.status === "no-routes") {
    return (
      <section className="rounded-2xl border border-dashed border-border bg-card p-8 text-center">
        <h2 className="text-lg font-bold">目前沒有可判讀的路線</h2>
        <p className="mt-2 text-sm text-muted-foreground">路線資料尚未建立，請稍後再回來看看。</p>
      </section>
    );
  }

  const { featured, routes } = data;
  /** 換路線、換頁時帶著的行程設定 */
  const tripParams: TripParams = { depart: trip.departure?.toISOString(), activity: trip.activity };

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <TripSettings
          departure={featured.departure}
          activity={featured.activity}
          speedKmh={featured.speedKmh}
          defaultActivity={featured.defaultActivity}
          explicitActivity={trip.activity}
          explicitDeparture={trip.departure?.toISOString() ?? null}
        />
        <RouteSwitcher routes={routes} currentId={featured.id} trip={tripParams} />
      </div>
      {/* 桌機左主卡、右沿途示警；手機依序往下 */}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] lg:items-start">
        <BriefingCard featured={featured} trip={tripParams} />
        <HazardSummary briefing={featured} trip={tripParams} />
      </div>
    </div>
  );
}
