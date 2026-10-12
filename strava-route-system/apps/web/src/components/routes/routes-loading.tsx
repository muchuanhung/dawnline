import Spinner from "@/components/ui/Spinner";

/** 路線清單載入中：換頁 loading.tsx 和 RoutesClient 讀取路線時共用，spinner 才會停在同一個位置 */
export function RoutesLoading() {
  return (
    <div className="flex min-h-[50dvh] items-center justify-center" role="status" aria-label="載入路線中">
      <Spinner size="lg" dotClassName="bg-primary" />
    </div>
  );
}
