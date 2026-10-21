import { Suspense } from "react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUserId } from "@/lib/auth/server";
import { AppShell } from "@/components/app-shell/app-shell";
import { Briefing } from "@/components/dashboard/briefing/briefing";
import { BriefingLoading } from "@/components/dashboard/briefing/briefing-loading";
import { DashboardHeader } from "@/components/dashboard/dashboard-header";
import { formatClock, parseActivity, parseDeparture } from "@/lib/routes/trip";

export const metadata: Metadata = { title: "今日判讀" };

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ route?: string; depart?: string; activity?: string }>;
}) {
  const started = Date.now();
  const userId = await getCurrentUserId();
  console.info(`[判讀計時] dashboard auth ${Date.now() - started}ms`);
  if (!userId) redirect("/login");

  const { route, depart, activity } = await searchParams;
  const now = new Date();
  const departure = parseDeparture(depart, now);
  const trip = { departure, activity: parseActivity(activity) };

  return (
    <AppShell current="dashboard">
      <DashboardHeader title={departure ? `${formatClock(departure, now)} 出發適合嗎？` : "現在出發適合嗎？"} />
      {/* 只在第一次進頁面時顯示；換路線時 Briefing 內部只讓判讀卡顯示載入中 */}
      <Suspense fallback={<BriefingLoading />}>
        <Briefing routeId={route} trip={trip} />
      </Suspense>
    </AppShell>
  );
}
