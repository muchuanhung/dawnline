import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUserId } from "@/lib/auth/server";
import { AppShell } from "@/components/app-shell/app-shell";
import { PrivateRoutesContent } from "@/components/routes/private-routes-content";
import { parseActivity, parseDeparture } from "@/lib/routes/trip";

export const metadata: Metadata = { title: "私人路線" };

/** 私人路線：登入才能看，GPX 存在 S3、metadata 在後端 MySQL；?route= 指定右側要判讀的路線 */
export default async function PrivateRoutesPage({
  searchParams,
}: {
  searchParams: Promise<{ route?: string; depart?: string; activity?: string }>;
}) {
  const userId = await getCurrentUserId();
  if (!userId) redirect("/login");

  const { route, depart, activity } = await searchParams;
  const trip = {
    depart: parseDeparture(depart, new Date())?.toISOString() ?? null,
    activity: parseActivity(activity),
  };
  return (
    <AppShell current="routes">
      <PrivateRoutesContent initialRouteId={route} trip={trip} />
    </AppShell>
  );
}
