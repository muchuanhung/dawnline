import { Suspense } from "react";
import type { Metadata } from "next";
import { getCurrentUserId } from "@/lib/auth/server";
import { AppShell } from "@/components/app-shell/app-shell";
import { Briefing } from "@/components/dashboard/briefing/briefing";
import { BriefingLoading } from "@/components/dashboard/briefing/briefing-loading";
import { DashboardHeader } from "@/components/dashboard/dashboard-header";
import { GuestNotice } from "@/components/dashboard/guest-notice";
import { cookies } from "next/headers";
import { formatClock, parseActivity, parseDeparture, parseSpeedPrefs, SPEED_COOKIE } from "@/lib/routes/trip";

export const metadata: Metadata = { title: "今日判讀" };

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ route?: string; depart?: string; activity?: string }>;
}) {
  // 未登入也能看公開路線的判讀（判讀流程不依賴使用者）；只多一個登入入口
  const signedIn = Boolean(await getCurrentUserId());

  const { route, depart, activity } = await searchParams;
  const now = new Date();
  const departure = parseDeparture(depart, now);
  // 自訂平地均速存在 cookie，不放網址
  const speeds = parseSpeedPrefs((await cookies()).get(SPEED_COOKIE)?.value);
  const trip = { departure, activity: parseActivity(activity), speeds };

  return (
    <AppShell current="dashboard">
      <DashboardHeader title={departure ? `${formatClock(departure, now)} 出發適合嗎？` : "現在出發適合嗎？"} />
      {!signedIn && <GuestNotice />}
      {/* 只在第一次進頁面時顯示；換路線時 Briefing 內部只讓判讀卡顯示載入中 */}
      <Suspense fallback={<BriefingLoading />}>
        <Briefing routeId={route} trip={trip} />
      </Suspense>
    </AppShell>
  );
}
