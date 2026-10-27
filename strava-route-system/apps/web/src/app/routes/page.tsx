import type { Metadata } from "next";
import { AppShell } from "@/components/app-shell/app-shell";
import { RoutesClient } from "@/components/routes/routes-client";
import { cookies } from "next/headers";
import { parseActivity, parseDeparture, parseSpeedPrefs, SPEED_COOKIE } from "@/lib/routes/trip";

export const metadata: Metadata = { title: "路線" };

/** 路線：公開頁面；?route= 指定要打開的路線（Dashboard 會帶過來） */
export default async function RoutesPage({
  searchParams,
}: {
  searchParams: Promise<{ route?: string; depart?: string; activity?: string }>;
}) {
  const { route, depart, activity } = await searchParams;
  // 行程設定與今日判讀共用同一組網址參數；無效值視為未指定
  const trip = {
    depart: parseDeparture(depart, new Date())?.toISOString() ?? null,
    activity: parseActivity(activity),
    // 自訂平地均速存在 cookie，不放網址（跨頁、下次開都沿用）
    speeds: parseSpeedPrefs((await cookies()).get(SPEED_COOKIE)?.value),
  };
  return (
    <AppShell current="routes">
      <RoutesClient initialRouteId={route} trip={trip} />
    </AppShell>
  );
}
