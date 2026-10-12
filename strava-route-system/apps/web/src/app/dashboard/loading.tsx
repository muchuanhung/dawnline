import { AppShell } from "@/components/app-shell/app-shell";
import { DashboardHeader } from "@/components/dashboard/dashboard-header";
import { BriefingLoading } from "@/components/dashboard/briefing/briefing-loading";

/**
 * 換頁進來時，伺服器還在準備頁面的這段時間：保留外框導覽，spinner 放在判讀區。
 * 版面和頁面本身的 Suspense fallback 相同，頁面接手後 spinner 不會跳位置。
 */
export default function Loading() {
  return (
    <AppShell current="dashboard">
      <DashboardHeader title="現在出發適合嗎？" placeholder />
      <BriefingLoading />
    </AppShell>
  );
}
