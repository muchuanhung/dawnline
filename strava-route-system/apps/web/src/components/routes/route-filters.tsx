"use client";

import { Search, Star, X } from "lucide-react";
import { ROUTE_TYPE_ICONS } from "@/constants";
import { ALL_TYPES } from "@/lib/routes/route-types";
import { cn } from "@/lib/utils";

/** 類型 icon；資料裡出現沒登記的新類型就只顯示文字 */
const TYPE_ICONS: Record<string, React.ComponentType<{ className?: string }> | undefined> = ROUTE_TYPE_ICONS;

const CHIP =
  "inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors";
const CHIP_ON = "border-primary bg-primary text-primary-foreground";
const CHIP_OFF = "border-border bg-card text-muted-foreground hover:text-foreground";

/**
 * 路線搜尋＋類型篩選：公開路線頁與私人路線頁共用。
 * types：目前路線資料實際有的類型（routeTypesOf）；少於兩種時篩選沒有意義，不顯示。
 * favoriteFilter：「只看收藏」切換（與類型篩選疊加）；未提供時不顯示。
 */
export function RouteFilters({
  search,
  onSearch,
  types,
  typeFilter,
  onFilter,
  favoriteFilter,
}: {
  search: string;
  onSearch: (v: string) => void;
  types: string[];
  typeFilter: string;
  onFilter: (v: string) => void;
  favoriteFilter?: { active: boolean; onToggle: () => void };
}) {
  const showTypes = types.length >= 2;
  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <input
          type="search"
          aria-label="搜尋路線"
          placeholder="搜尋路線..."
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          className="h-9 w-full rounded-lg border border-input bg-background pl-9 pr-8 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        />
        {search && (
          <button
            type="button"
            onClick={() => onSearch("")}
            aria-label="清除搜尋"
            className="absolute right-2.5 top-1/2 -translate-y-1/2 cursor-pointer text-muted-foreground hover:text-foreground"
          >
            <X className="size-3.5" aria-hidden />
          </button>
        )}
      </div>
      {(showTypes || favoriteFilter) && (
        <div className="flex flex-wrap items-center gap-2">
          {favoriteFilter && (
            <button
              type="button"
              onClick={favoriteFilter.onToggle}
              aria-pressed={favoriteFilter.active}
              className={cn(CHIP, favoriteFilter.active ? CHIP_ON : CHIP_OFF)}
            >
              <Star className={cn("size-3", favoriteFilter.active && "fill-current")} aria-hidden />
              收藏
            </button>
          )}
          {(showTypes ? [ALL_TYPES, ...types] : []).map((value) => {
            const Icon = TYPE_ICONS[value];
            return (
              <button
                key={value}
                type="button"
                onClick={() => onFilter(value)}
                aria-pressed={typeFilter === value}
                className={cn(CHIP, typeFilter === value ? CHIP_ON : CHIP_OFF)}
              >
                {Icon && <Icon className="size-3" aria-hidden />}
                {value}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
