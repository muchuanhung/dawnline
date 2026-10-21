/**
 * AI 一句話摘要的守門規則：模型只能改措辭，不能改判定、編數字或加沒有根據的路況描述。
 */

import { test, expect } from "@playwright/test";
import type { RouteBriefing } from "@/lib/dashboard/briefing";
import { briefingFacts, checkSummary, summaryApplies, type SummaryFacts } from "@/lib/dashboard/briefing-summary";
import type { ReconVerdict } from "@/lib/routes/recon-geo";

const NOW = new Date("2026-10-21T00:00:00Z"); // 台灣 08:00

function briefing(verdict: ReconVerdict, overrides: Partial<RouteBriefing> = {}): RouteBriefing {
  return {
    id: "r1",
    name: "淡水－八里",
    distanceKm: 32.44,
    elevationGainM: 120,
    verdict,
    hazards: [],
    roadEvents: [],
    maxRain: 70,
    maxWindKmh: 18.2,
    temperature: { min: 21, max: 26 },
    periodLabel: "12:00–18:00",
    elevationProfile: [],
    segments: [],
    eventsFailed: [],
    departureSuggestion: null,
    departure: NOW.toISOString(),
    activity: "cycling",
    speedKmh: 20,
    defaultActivity: "cycling",
    demo: false,
    fromKm: null,
    ...overrides,
  } as RouteBriefing;
}

const CAUTION = briefing(
  { level: "caution", headline: "12.4 km 起降雨 70%", note: "另有 1 項示警" },
  {
    hazards: [
      { id: "h1", kind: "rain", level: "caution", startKm: 12.44, endKm: 18, label: "降雨 70%" },
      { id: "h2", kind: "event", level: "caution", startKm: 25, endKm: 25.5, label: "施工：車道縮減" },
    ],
    departureSuggestion: {
      from: "2026-10-20T22:00:00Z",
      to: "2026-10-21T00:00:00Z",
      level: null,
      nowIsBest: false,
    },
  }
);
const UNKNOWN = briefing(
  { level: "unknown", reasons: ["no_data"], headline: "資料不完整，無法確認安全", note: "部分路段無天氣資料" },
  { maxRain: null, maxWindKmh: null, temperature: null }
);
const CLEAR = briefing({ level: "clear", headline: "沿途無示警", note: "" });

test.describe("briefingFacts", () => {
  test("只帶規則算好的結果，里程四捨五入到 0.1 km", () => {
    const f = briefingFacts(CAUTION, NOW);
    expect(f.level).toBe("caution");
    expect(f.levelWord).toBe("注意");
    expect(f.headline).toBe("12.4 km 起降雨 70%");
    expect(f.distanceKm).toBe(32.4);
    expect(f.hazards[0]).toEqual({ label: "降雨 70%", startKm: 12.4, endKm: 18, level: "注意" });
    expect(f.weather).toBe("降雨機率最高 70%、風速最高 18 km/h、氣溫 21–26°C");
    expect(f.departureSuggestion).toBe("06:00–08:00");
  });

  test("現在出發就是最佳時段時不帶建議；沒有天氣資料時 weather 為 null", () => {
    const f = briefingFacts(UNKNOWN, NOW);
    expect(f.departureSuggestion).toBeNull();
    expect(f.weather).toBeNull();
  });

  test("示警最多 3 項，其餘只記數量", () => {
    const hazards = Array.from({ length: 5 }, (_, i) => ({
      id: `h${i}`,
      kind: "rain" as const,
      level: "caution" as const,
      startKm: i,
      endKm: i + 1,
      label: "降雨 50%",
    }));
    const f = briefingFacts(briefing(CAUTION.verdict, { hazards }), NOW);
    expect(f.hazards).toHaveLength(3);
    expect(f.otherHazardCount).toBe(2);
  });
});

test.describe("checkSummary", () => {
  const caution: SummaryFacts = briefingFacts(CAUTION, NOW);
  const unknown: SummaryFacts = briefingFacts(UNKNOWN, NOW);
  const clear: SummaryFacts = briefingFacts(CLEAR, NOW);

  test("通過：引用事實裡的數字與用詞，去掉引號", () => {
    expect(checkSummary("「建議 06:00–08:00 出發，12.4 km 起降雨機率 70%。」", caution)).toBe(
      "建議 06:00–08:00 出發，12.4 km 起降雨機率 70%。"
    );
  });

  test("擋下：事實裡沒有的數字", () => {
    expect(checkSummary("12.4 km 起降雨機率 80%，請小心。", caution)).toBeNull();
    expect(checkSummary("10 km 起降雨機率 70%。", caution)).toBeNull();
  });

  test("擋下：事實裡沒有的路況用詞", () => {
    expect(checkSummary("12.4 km 起降雨，路面濕滑。", caution)).toBeNull();
    expect(checkSummary("沿途無示警，但有霧。", clear)).toBeNull();
  });

  test("擋下：有示警卻說安全或放心", () => {
    expect(checkSummary("12.4 km 起降雨，整體仍算安全。", caution)).toBeNull();
    expect(checkSummary("降雨不大，可以放心出發。", caution)).toBeNull();
  });

  test("未判定：必須說未判定，不能說安全；否定語境的安全可以", () => {
    expect(checkSummary("部分路段無天氣資料，可以出發。", unknown)).toBeNull();
    expect(checkSummary("部分路段無天氣資料，路線安全。", unknown)).toBeNull();
    expect(checkSummary("部分路段無天氣資料，目前未判定，不代表安全。", unknown)).toBe(
      "部分路段無天氣資料，目前未判定，不代表安全。"
    );
  });

  test("安全：不能說危險或未判定", () => {
    expect(checkSummary("沿途無示警，可以安心出發。", clear)).toBe("沿途無示警，可以安心出發。");
    expect(checkSummary("沿途無示警，但仍未判定。", clear)).toBeNull();
  });

  test("擋下：多句、換行、過長、空字串", () => {
    expect(checkSummary("12.4 km 起降雨。建議 06:00 出發。", caution)).toBeNull();
    expect(checkSummary("12.4 km 起降雨\n建議 06:00 出發", caution)).toBeNull();
    expect(checkSummary("降雨".repeat(31), caution)).toBeNull();
    expect(checkSummary("   ", caution)).toBeNull();
  });
});

test.describe("summaryApplies", () => {
  const summary = { text: "12.4 km 起降雨機率 70%。", level: "caution" as const, headline: "12.4 km 起降雨 70%" };

  test("依據的判定與畫面相同才使用", () => {
    expect(summaryApplies(summary, CAUTION.verdict)).toBe(true);
    expect(summaryApplies(summary, { level: "unknown", headline: "12.4 km 起降雨 70%" })).toBe(false);
    expect(summaryApplies(summary, { level: "caution", headline: "3.0 km 起強風" })).toBe(false);
    expect(summaryApplies(null, CAUTION.verdict)).toBe(false);
  });
});
