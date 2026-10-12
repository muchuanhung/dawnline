import { AppShell } from "@/components/app-shell/app-shell";
import { DashboardHeader } from "@/components/dashboard/dashboard-header";
import { BriefingLoading } from "@/components/dashboard/briefing/briefing-loading";

export default function Loading() {
  return (
    <AppShell current="dashboard">
      <DashboardHeader title="現在出發適合嗎？" placeholder />
      <BriefingLoading />
    </AppShell>
  );
}
