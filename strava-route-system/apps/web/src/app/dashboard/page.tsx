import { Suspense } from "react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUserId } from "@/lib/auth/server";
import { AppShell } from "@/components/app-shell/app-shell";
import { Briefing } from "@/components/dashboard/briefing/briefing";
import { BriefingLoading } from "@/components/dashboard/briefing/briefing-loading";
import { formatClock, parseActivity, parseDeparture } from "@/lib/routes/trip";

export const metadata: Metadata = { title: "今日判讀" };

/** 依台灣時間問候（伺服器在 UTC 也正確） */
function greeting(now = new Date()): string {
  const hour = Number(
    new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone: "Asia/Taipei" }).format(now)
  );
  if (hour >= 5 && hour < 11) return "早安";
  if (hour >= 11 && hour < 18) return "午安";
  return "晚安";
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ route?: string; depart?: string; activity?: string }>;
}) {
  const userId = await getCurrentUserId();
  if (!userId) redirect("/login");

  const { route, depart, activity } = await searchParams;
  const now = new Date();
  const departure = parseDeparture(depart, now);
  const trip = { departure, activity: parseActivity(activity) };

  return (
    <AppShell current="dashboard">
      <header className="mb-6 space-y-1">
        <p className="text-sm text-muted-foreground">{greeting()}</p>
        <h1 className="text-2xl font-black tracking-tight sm:text-3xl">
          {departure ? `${formatClock(departure, now)} 出發適合嗎？` : "現在出發適合嗎？"}
        </h1>
      </header>
      <Suspense key={[route, depart, activity].join("|")} fallback={<BriefingLoading />}>
        <Briefing routeId={route} trip={trip} />
      </Suspense>
    </AppShell>
  );
}
