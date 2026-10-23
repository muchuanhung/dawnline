/**
 * 路線類型篩選：選項依資料產生、不寫死；選的類型消失時退回「全部」
 */
import { test, expect } from "@playwright/test";
import { ALL_TYPES, effectiveTypeFilter, matchesTypeFilter, routeTypesOf } from "@/lib/routes/route-types";

const of = (...types: string[]) => types.map((type) => ({ type }));

test.describe("routeTypesOf", () => {
  test("only types present in the data, deduplicated", () => {
    expect(routeTypesOf(of("自行車", "自行車", "健行"))).toEqual(["自行車", "健行"]);
  });

  test("known types follow the display order regardless of data order", () => {
    expect(routeTypesOf(of("雪巴運動", "健行", "跑步", "自行車"))).toEqual(["自行車", "跑步", "健行", "雪巴運動"]);
  });

  test("an unknown type from the data is kept, after the known ones", () => {
    expect(routeTypesOf(of("溯溪", "自行車"))).toEqual(["自行車", "溯溪"]);
  });

  test("no routes means no types", () => {
    expect(routeTypesOf([])).toEqual([]);
  });
});

test.describe("matchesTypeFilter", () => {
  test("all matches everything, a type matches only itself", () => {
    expect(matchesTypeFilter("健行", ALL_TYPES)).toBe(true);
    expect(matchesTypeFilter("健行", "健行")).toBe(true);
    expect(matchesTypeFilter("健行", "跑步")).toBe(false);
  });
});

test.describe("effectiveTypeFilter", () => {
  test("keeps all and types that still exist", () => {
    expect(effectiveTypeFilter(ALL_TYPES, [])).toBe(ALL_TYPES);
    expect(effectiveTypeFilter("健行", ["自行車", "健行"])).toBe("健行");
  });

  test("falls back to all when the selected type is gone", () => {
    expect(effectiveTypeFilter("健行", ["自行車"])).toBe(ALL_TYPES);
  });
});
