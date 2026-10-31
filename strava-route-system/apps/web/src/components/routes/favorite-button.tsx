"use client";

import Link from "next/link";
import { Star } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Favorites } from "@/hooks/useFavorites";

const BUTTON =
  "inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-secondary/40 transition-colors hover:bg-secondary disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/**
 * 路線卡右上角的收藏星號（公開路線與私人路線詳情共用）。
 * 未登入時是一個連到登入頁的星號（不另放登入按鈕，同一畫面只有一個登入入口）。
 */
export function FavoriteButton({ routeId, favorites }: { routeId: string; favorites: Favorites }) {
  if (favorites.guest) {
    return (
      <Link href="/login" className={BUTTON} aria-label="登入後收藏這條路線" title="登入後收藏">
        <Star className="size-4 text-muted-foreground" aria-hidden />
      </Link>
    );
  }
  const active = favorites.isFavorite(routeId);
  return (
    <button
      type="button"
      onClick={() => favorites.toggle(routeId)}
      // 登入中（後端 session 還沒換好）先停用，避免按了沒反應
      disabled={!favorites.signedIn}
      aria-pressed={active}
      aria-label={active ? "取消收藏" : "收藏這條路線"}
      title={active ? "取消收藏" : "收藏"}
      className={BUTTON}
    >
      <Star className={cn("size-4", active ? "fill-amber-400 text-amber-400" : "text-muted-foreground")} aria-hidden />
    </button>
  );
}
