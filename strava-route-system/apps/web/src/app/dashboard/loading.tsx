import Spinner from "@/components/ui/Spinner";

/** 換頁進來時，伺服器還在準備頁面的這段時間顯示整頁 spinner（同登入後轉場的樣式） */
export default function Loading() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background" role="status" aria-label="載入今日判讀中">
      <Spinner size="lg" dotClassName="bg-primary" />
    </div>
  );
}
