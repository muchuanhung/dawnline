/**
 * 路線類型篩選的選項：依目前載入的路線實際有的類型產生，不寫死分類。
 * 純函式，不依賴 React，可單元測試。
 */

/** 「全部」一律符合 */
export const ALL_TYPES = "全部";

/** 已知類型的顯示順序；資料裡出現的新類型排在後面（依字串排序） */
const TYPE_ORDER = ["自行車", "跑步", "健行", "雪巴運動", "混合"];

/** 路線資料裡出現過的類型（去重、依 TYPE_ORDER 排序），不含「全部」 */
export function routeTypesOf(routes: { type: string }[]): string[] {
  const rank = (t: string) => {
    const i = TYPE_ORDER.indexOf(t);
    return i === -1 ? TYPE_ORDER.length : i;
  };
  return [...new Set(routes.map((r) => r.type))].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b, "zh-Hant"));
}

/** 類型是否符合目前篩選 */
export function matchesTypeFilter(type: string, filter: string): boolean {
  return filter === ALL_TYPES || type === filter;
}

/** 目前選的類型已不在資料裡（例如刪掉該類型最後一條路線）時退回「全部」 */
export function effectiveTypeFilter(filter: string, types: string[]): string {
  return filter === ALL_TYPES || types.includes(filter) ? filter : ALL_TYPES;
}
