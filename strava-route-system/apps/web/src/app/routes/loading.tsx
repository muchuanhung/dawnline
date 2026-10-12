import { AppShell } from "@/components/app-shell/app-shell";
import { RoutesLoading } from "@/components/routes/routes-loading";

/** 換頁進來時，伺服器還在準備頁面的這段時間：保留外框導覽，spinner 和 RoutesClient 讀取路線時同一個位置 */
export default function Loading() {
  return (
    <AppShell current="routes">
      <RoutesLoading />
    </AppShell>
  );
}
