"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { withTrip } from "@/lib/routes/trip";
import { loadTrip, TRIP_CHANGE_EVENT } from "@/lib/routes/trip-storage";

/**
 * 導覽到今日判讀／路線的連結：帶上記住的行程設定（出發時間、運動類型），切頁回來不會被重設。
 * 設定直接寫進 href，讓 Next 預先載入的就是實際要去的網址：預載過的頁面點下去會立刻顯示 loading.tsx 的 spinner；
 * 若點擊時才 router.push 一個沒預載過的網址，畫面會停在舊頁直到伺服器回應。
 */
export function TripNavLink(props: React.ComponentProps<typeof Link> & { href: string }) {
  const { href } = props;
  // Server render and first client render use the bare href to avoid a hydration mismatch
  const [target, setTarget] = useState(href);

  useEffect(() => {
    const sync = () => setTarget(withTrip(href, loadTrip(new Date())));
    sync();
    window.addEventListener(TRIP_CHANGE_EVENT, sync);
    return () => window.removeEventListener(TRIP_CHANGE_EVENT, sync);
  }, [href]);

  return <Link {...props} href={target} />;
}
