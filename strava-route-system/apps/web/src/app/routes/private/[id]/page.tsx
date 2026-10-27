import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUserId } from "@/lib/auth/server";
import { AppShell } from "@/components/app-shell/app-shell";
import { PrivateRouteDetail } from "@/components/routes/private-route-detail";
import { cookies } from "next/headers";
import { parseActivity, parseDeparture, parseSpeedPrefs, SPEED_COOKIE } from "@/lib/routes/trip";

export const metadata: Metadata = { title: "我的路線" };

/** 私人路線詳情：登入才能看；路線是否屬於本人由後端判斷（不是本人的回 404） */
export default async function PrivateRouteDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ depart?: string; activity?: string }>;
}) {
  const userId = await getCurrentUserId();
  if (!userId) redirect("/login");

  const [{ id }, { depart, activity }] = await Promise.all([params, searchParams]);
  // 行程設定與公開路線頁共用同一組網址參數；無效值視為未指定
  const trip = {
    depart: parseDeparture(depart, new Date())?.toISOString() ?? null,
    activity: parseActivity(activity),
    // 自訂平地均速存在 cookie，不放網址（跨頁、下次開都沿用）
    speeds: parseSpeedPrefs((await cookies()).get(SPEED_COOKIE)?.value),
  };
  return (
    <AppShell current="routes">
      <PrivateRouteDetail routeId={id} trip={trip} />
    </AppShell>
  );
}
