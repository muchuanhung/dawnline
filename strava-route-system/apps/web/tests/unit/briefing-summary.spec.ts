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
    const f = briefingFacts(CAUTION);
    expect(f.level).toBe("caution");
    expect(f.headline).toBe("12.4 km 起降雨 70%");
    expect(f.distanceKm).toBe(32.4);
    expect(f.hazards[0]).toEqual({ label: "降雨 70%", startKm: 12.4, endKm: 18, level: "注意" });
    expect(f.weather).toBe("降雨機率最高 70%、風速最高 18 km/h、氣溫 21–26°C");
    // 判定詞、note（示警數）與行動建議畫面已另外顯示，不給模型
    expect(f).not.toHaveProperty("note");
    expect(f).not.toHaveProperty("levelWord");
    expect(f).not.toHaveProperty("departureSuggestion");
    expect(f).not.toHaveProperty("alternative");
  });

  test("沒有天氣資料時 weather 為 null", () => {
    const f = briefingFacts(UNKNOWN);
    expect(f.weather).toBeNull();
  });

  test("示警最多 3 項", () => {
    const hazards = Array.from({ length: 5 }, (_, i) => ({
      id: `h${i}`,
      kind: "rain" as const,
      level: "caution" as const,
      startKm: i,
      endKm: i + 1,
      label: "降雨 50%",
    }));
    const f = briefingFacts(briefing(CAUTION.verdict, { hazards }));
    expect(f.hazards).toHaveLength(3);
  });
});

test.describe("checkSummary", () => {
  const caution: SummaryFacts = briefingFacts(CAUTION);
  const unknown: SummaryFacts = briefingFacts(UNKNOWN);
  const clear: SummaryFacts = briefingFacts(CLEAR);

  test("通過：引用事實裡的數字與用詞，去掉引號", () => {
    expect(checkSummary("「12.4 km 起降雨機率 70%，氣溫 21–26°C。」", caution)).toBe("12.4 km 起降雨機率 70%，氣溫 21–26°C。");
  });

  test("半形逗號換成全形", () => {
    expect(checkSummary("12.4 km 起降雨機率 70%,風速最高 18 km/h。", caution)).toBe("12.4 km 起降雨機率 70%，風速最高 18 km/h。");
  });

  test("距離單位統一寫 km", () => {
    expect(checkSummary("從12.4公里處起降雨機率升至70%。", caution)).toBe("從12.4 km處起降雨機率升至70%。");
  });

  test("擋下：重複畫面已有的判定等級與示警數", () => {
    expect(checkSummary("此路線屬注意等級，12.4 km 起降雨機率 70%。", caution)).toBeNull();
    expect(checkSummary("12.4 km 起降雨機率 70%，另有 1 項示警。", caution)).toBeNull();
  });

  test("擋下：句子自己給行動建議（建議由規則產生）", () => {
    expect(checkSummary("12.4 km 起降雨機率 70%，請先避開此路段。", caution)).toBeNull();
    expect(checkSummary("12.4 km 起降雨機率 70%，建議改期。", caution)).toBeNull();
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
    expect(checkSummary("12.4 km 起降雨。氣溫 21–26°C。", caution)).toBeNull();
    expect(checkSummary("12.4 km 起降雨\n氣溫 21–26°C", caution)).toBeNull();
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
