/**
 * 判定牌行動建議與路線卡建議出發時間：危險時不能建議現在出發。
 */

import { test, expect } from "@playwright/test";
import type { DepartureSuggestion, RouteBriefing } from "@/lib/dashboard/briefing";
import { departureLabelOf, riskyAdvice } from "@/lib/dashboard/advice";

const NOW = new Date("2026-10-21T00:00:00Z"); // 台灣 08:00

const suggestion = (over: Partial<DepartureSuggestion>): DepartureSuggestion => ({
  from: "2026-10-21T02:00:00Z",
  to: "2026-10-21T03:00:00Z",
  level: null,
  nowIsBest: false,
  ...over,
});

const route = (departureSuggestion: DepartureSuggestion | null, name = "冷水坑", hazards: RouteBriefing["hazards"] = []) =>
  ({ id: name, name, departureSuggestion, hazards }) as RouteBriefing;

test.describe("riskyAdvice", () => {
  test("有較好的出發時段時建議改時段（時間由建議出發時段列顯示）", () => {
    expect(riskyAdvice(route(suggestion({ level: "caution" })))).toBe("建議改時段出發，或改期。");
  });

  test("各時段都危險、危險來自路況事件、沒有建議時段或現在就是最佳時段時只說改期", () => {
    const event = { id: "e", kind: "event" as const, level: "risky" as const, startKm: 3, endKm: 3.2, label: "事故" };
    expect(riskyAdvice(route(suggestion({ level: "risky" })))).toBe("建議改期。");
    expect(riskyAdvice(route(suggestion({ level: null }), "冷水坑", [event]))).toBe("建議改期。");
    expect(riskyAdvice(route(null))).toBe("建議改期。");
    expect(riskyAdvice(route(suggestion({ nowIsBest: true })))).toBe("建議改期。");
  });
});

test.describe("departureLabelOf", () => {
  test("建議時段仍危險時不顯示", () => {
    expect(departureLabelOf(suggestion({ nowIsBest: true, level: "risky" }), NOW)).toBeNull();
    expect(departureLabelOf(suggestion({ level: "risky" }), NOW)).toBeNull();
    expect(departureLabelOf(null, NOW)).toBeNull();
  });

  test("非危險時段：現在或台灣時間", () => {
    expect(departureLabelOf(suggestion({ nowIsBest: true }), NOW)).toBe("現在");
    expect(departureLabelOf(suggestion({ level: "caution" }), NOW)).toBe("10:00");
  });
});
