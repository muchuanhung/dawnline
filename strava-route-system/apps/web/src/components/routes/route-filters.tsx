"use client";

import { Search, Bike, Footprints, Mountain, Trophy, X } from "lucide-react";
import { cn } from "@/lib/utils";

export type FilterType = "全部" | "自行車" | "跑步" | "健行" | "雪巴運動";

const FILTERS: { value: FilterType; icon?: React.ComponentType<{ className?: string }> }[] = [
  { value: "全部" },
  { value: "自行車", icon: Bike },
  { value: "跑步", icon: Footprints },
  { value: "健行", icon: Mountain },
  { value: "雪巴運動", icon: Trophy },
];

/** 類型是否符合目前篩選（「全部」一律符合） */
export function matchesTypeFilter(type: string, filter: FilterType): boolean {
  return filter === "全部" || type === filter;
}

/** 路線搜尋＋類型篩選：公開路線頁與私人路線頁共用 */
export function RouteFilters({
  search,
  onSearch,
  typeFilter,
  onFilter,
}: {
  search: string;
  onSearch: (v: string) => void;
  typeFilter: FilterType;
  onFilter: (v: FilterType) => void;
}) {
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
      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map(({ value, icon: Icon }) => (
          <button
            key={value}
            type="button"
            onClick={() => onFilter(value)}
            aria-pressed={typeFilter === value}
            className={cn(
              "inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
              typeFilter === value
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-card text-muted-foreground hover:text-foreground"
            )}
          >
            {Icon && <Icon className="size-3" aria-hidden />}
            {value}
          </button>
        ))}
      </div>
    </div>
  );
}
