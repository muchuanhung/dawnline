import Spinner from "@/components/ui/Spinner";

/** 判讀串流中（換路線、改出發或運動）：和整頁載入同一種 spinner；保留大致高度，避免完成時版面大跳 */
export function BriefingLoading() {
  return (
    <div className="flex min-h-[26rem] items-center justify-center" role="status" aria-label="正在判讀路線">
      <Spinner size="lg" dotClassName="bg-primary" />
    </div>
  );
}
