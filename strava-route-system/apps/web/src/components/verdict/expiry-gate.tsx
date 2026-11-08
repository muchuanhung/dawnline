"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { isBriefingExpired } from "@/lib/routes/snapshot";

/** 過期要隨時間重算，不必等使用者操作 */
const TICK_MS = 30_000;
/** 回到前景時，判讀超過這個時間就重新整理一次（與路線頁 useRouteBriefing 相同） */
const REFRESH_ON_RETURN_MS = 10 * 60_000;

/**
 * 伺服器端渲染的判讀（今日判讀卡、首頁精選路線）的過期閘門：
 * 判讀超過 30 分鐘（SNAPSHOT_MAX_AGE_MS）就改顯示 expired（伺服器已用 expireVerdict 算好的版本），
 * 頁面開著不動、從背景回來、上一頁的 bfcache，或 Service Worker 離線送出的舊頁面都適用（未判定 ≠ 安全）。
 * refreshOnReturn：回到前景且判讀已舊時 router.refresh() 重新判讀；只在回前景時觸發，不會變成輪詢。
 * 伺服器與第一次 render 一律顯示 children，掛載後才依現在時間判斷，避免 hydration 不一致。
 */
export function ExpiryGate({
  generatedAt,
  expired,
  refreshOnReturn = false,
  children,
}: {
  generatedAt: string;
  expired: ReactNode;
  refreshOnReturn?: boolean;
  children: ReactNode;
}) {
  const router = useRouter();
  const [now, setNow] = useState<number | null>(null);
  // 同一份判讀只重新整理一次：離線時 refresh 失敗，不重複觸發
  const refreshedFor = useRef<string | null>(null);

  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    const onReturn = () => {
      if (document.visibilityState !== "visible") return;
      const t = Date.now();
      setNow(t);
      const age = t - Date.parse(generatedAt);
      if (refreshOnReturn && !(age < REFRESH_ON_RETURN_MS) && refreshedFor.current !== generatedAt) {
        refreshedFor.current = generatedAt;
        router.refresh();
      }
    };
    document.addEventListener("visibilitychange", onReturn);
    window.addEventListener("pageshow", onReturn);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onReturn);
      window.removeEventListener("pageshow", onReturn);
    };
  }, [generatedAt, refreshOnReturn, router]);

  return <>{now != null && isBriefingExpired(generatedAt, now) ? expired : children}</>;
}
