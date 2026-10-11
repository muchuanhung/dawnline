"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { withTrip } from "@/lib/routes/trip";
import { loadTrip } from "@/lib/routes/trip-storage";

/**
 * 導覽到今日判讀／路線的連結：點擊時帶上記住的行程設定（出發時間、運動類型），切頁回來不會被重設。
 * 修飾鍵或中鍵點擊（開新分頁）走原本的連結。
 */
export function TripNavLink(props: React.ComponentProps<typeof Link> & { href: string }) {
  const router = useRouter();
  const { href, onClick } = props;
  return (
    <Link
      {...props}
      onClick={(e) => {
        onClick?.(e);
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        // Read storage at click time so a change made on this page is picked up without remounting
        const target = withTrip(href, loadTrip(new Date()));
        if (target === href) return;
        e.preventDefault();
        router.push(target);
      }}
    />
  );
}
