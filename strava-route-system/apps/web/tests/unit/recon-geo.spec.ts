import { test, expect } from "@playwright/test";
import {
  buildCctvMarkers,
  windLevel,
  computeHazards,
  deriveStages,
  isWeatherHazard,
  mapLatLonToKm,
  stageAtKm,
  summarizeVerdict,
} from "@/lib/routes/recon-geo";
import { CCTV_FEED, makeRoute, segment, slopeProfile, withWeather } from "../fixtures/route";

test.describe("風速門檻（蒲福風級）", () => {
  test("5 級起注意、7 級起危險；沿海常見的 36 km/h 為注意", () => {
    expect(windLevel(28)).toBeNull();
    expect(windLevel(29)).toBe("caution");
    expect(windLevel(36)).toBe("caution");
    expect(windLevel(49)).toBe("caution");
    expect(windLevel(50)).toBe("risky");
  });
});

test.describe("computeHazards 只計算天氣", () => {
  test("陡坡路線也只產生降雨、風、雷雨示警", () => {
    const route = makeRoute({
      elevationProfile: slopeProfile(0.2),
      segments: [segment("士林區", [0, 10, 20], withWeather(70, { windSpeed: 40, condition: "stormy" }))],
    });
    const hazards = computeHazards(route, deriveStages(route));
    expect(new Set(hazards.map((h) => h.kind))).toEqual(new Set(["rain", "wind", "storm"]));
    expect(hazards.every(isWeatherHazard)).toBe(true);
  });

  test("陡坡、天氣良好：沒有任何示警", () => {
    const route = makeRoute({
      elevationProfile: slopeProfile(0.2),
      segments: [segment("士林區", [0, 10, 20], withWeather(10))],
    });
    expect(computeHazards(route, deriveStages(route))).toEqual([]);
  });
});

test.describe("mapLatLonToKm", () => {
  // 沿經線往北 2 km 的直線路線
  const points: [number, number][] = [
    [25.0, 121.55],
    [25.0 + 2 / 110.574, 121.55],
  ];
  const cumulativeKm = [0, 2];

  test("路線東側 100 m 的點：離路 0.1 km（不可放大 57 倍）", () => {
    const dLon = 0.1 / (111.32 * Math.cos((25.009 * Math.PI) / 180));
    const r = mapLatLonToKm(25.0 + 1 / 110.574, 121.55 + dLon, points, cumulativeKm)!;
    expect(r.km).toBeCloseTo(1, 2);
    expect(r.distKm).toBeCloseTo(0.1, 2);
  });

  test("路線上的點：離路 0", () => {
    expect(mapLatLonToKm(25.0 + 0.5 / 110.574, 121.55, points, cumulativeKm)!.distKm).toBeCloseTo(0, 4);
  });
});

function hazardsOf(route: ReturnType<typeof makeRoute>) {
  const stages = deriveStages(route);
  return { stages, hazards: computeHazards(route, stages) };
}

test.describe("deriveStages", () => {
  test("依 sampleKms 排序切段，交界取兩側取樣的中點（相容舊快取的環狀路線資料）", () => {
    const route = makeRoute({
      segments: [segment("士林區", [0, 20]), segment("北投區", [10])],
    });
    const stages = deriveStages(route);
    expect(stages.map((s) => [s.name, s.startKm, s.endKm])).toEqual([
      ["士林區", 0, 5],
      ["北投區", 5, 15],
      ["士林區", 15, 20],
    ]);
    expect(stageAtKm(stages, 0)?.name).toBe("士林區");
    expect(stageAtKm(stages, 10)?.name).toBe("北投區");
    expect(stageAtKm(stages, 20)?.name).toBe("士林區");
  });

  test("密集取樣：連續同區合併成一個 stage，涵蓋區間連續無縫", () => {
    const kms = (from: number, to: number) => Array.from({ length: (to - from) * 2 + 1 }, (_, i) => from + i / 2);
    const route = makeRoute({
      segments: [segment("士林區", kms(0, 6)), segment("北投區", kms(6.5, 14)), segment("內湖區", kms(14.5, 20))],
    });
    const stages = deriveStages(route);
    expect(stages.map((s) => [s.name, s.startKm, s.endKm])).toEqual([
      ["士林區", 0, 6.25],
      ["北投區", 6.25, 14.25],
      ["內湖區", 14.25, 20],
    ]);
    // 位置在北投區範圍內但離內湖區代表點較近時，仍應回傳北投區
    expect(stageAtKm(stages, 14)?.name).toBe("北投區");
  });

  test("舊資料沒有 sampleKms 時退回 5 點依索引對應，連續同區合併", () => {
    const route = makeRoute({
      segments: [segment("大安區", []), segment("中山區", [])].map((s) => ({ ...s, sampleKms: undefined })),
    });
    expect(deriveStages(route).map((s) => [s.name, s.startKm, s.endKm])).toEqual([
      ["大安區", 0, 2.5],
      ["中山區", 2.5, 20],
    ]);
  });
});

test.describe("computeHazards：天氣", () => {
  test("相鄰同等級的降雨路段合併為一筆", () => {
    const route = makeRoute({
      segments: [segment("士林區", [0, 5], withWeather(70)), segment("北投區", [10, 15, 20], withWeather(10))],
    });
    const rain = hazardsOf(route).hazards.filter((h) => h.kind === "rain");
    expect(rain).toHaveLength(1);
    expect(rain[0]).toMatchObject({ level: "risky", startKm: 0, endKm: 7.5, label: "降雨 70%" });
  });

  test("降雨 40% 為注意、60% 為危險、39% 無示警", () => {
    const levelFor = (rain: number) => {
      const route = makeRoute({ segments: [segment("士林區", [0, 10, 20], withWeather(rain))] });
      return hazardsOf(route).hazards.find((h) => h.kind === "rain")?.level ?? null;
    };
    expect(levelFor(39)).toBeNull();
    expect(levelFor(40)).toBe("caution");
    expect(levelFor(60)).toBe("risky");
  });

  test("預報有雨但降雨機率未達門檻，列為注意", () => {
    const route = makeRoute({
      segments: [segment("士林區", [0, 10, 20], withWeather(30, { condition: "rainy" }))],
    });
    const rain = hazardsOf(route).hazards.find((h) => h.kind === "rain");
    expect(rain).toMatchObject({ level: "caution", label: "降雨 30%" });
  });

  test("沒有天氣資料的路段不產生天氣示警（預設 0 不可當成真值）", () => {
    const route = makeRoute({
      segments: [segment("士林區", [0, 10, 20], { rainProbability: 90, hasWeather: false })],
    });
    expect(hazardsOf(route).hazards).toEqual([]);
  });
});

test.describe("summarizeVerdict", () => {
  test("完全沒有天氣資料時為未判定，不可顯示安全", () => {
    const route = makeRoute({ segments: [segment("士林區", [0, 10, 20])] });
    const { stages, hazards } = hazardsOf(route);
    expect(summarizeVerdict(hazards, stages)).toMatchObject({ level: "unknown", headline: "尚無天氣資料" });
  });

  test("有天氣且無示警時為安全", () => {
    const route = makeRoute({ segments: [segment("士林區", [0, 10, 20], withWeather(10))] });
    const { stages, hazards } = hazardsOf(route);
    expect(summarizeVerdict(hazards, stages)).toEqual({ level: "clear", headline: "沿途無示警", note: "" });
  });

  test("部分路段無天氣時不可宣稱安全，必須為未判定", () => {
    const route = makeRoute({
      segments: [segment("士林區", [0, 5], withWeather(10)), segment("北投區", [10, 15, 20])],
    });
    const { stages, hazards } = hazardsOf(route);
    const verdict = summarizeVerdict(hazards, stages);
    expect(verdict.level).toBe("unknown");
    expect(verdict.note).toContain("部分路段無天氣資料");
  });

  test("部分路段無天氣但有示警時，示警等級優先", () => {
    const route = makeRoute({
      segments: [segment("士林區", [0, 5], withWeather(70)), segment("北投區", [10, 15, 20])],
    });
    const { stages, hazards } = hazardsOf(route);
    const verdict = summarizeVerdict(hazards, stages);
    expect(verdict.level).toBe("risky");
    expect(verdict.note).toContain("部分路段無天氣資料");
  });

  test("取最嚴重的示警作為判定，並列出其他示警數", () => {
    const route = makeRoute({
      segments: [segment("士林區", [0, 10, 20], withWeather(70, { windSpeed: 40 }))],
    });
    const { stages, hazards } = hazardsOf(route);
    const verdict = summarizeVerdict(hazards, stages);
    expect(verdict.level).toBe("risky");
    expect(verdict.headline).toBe("0.0 km 起降雨 70%");
    expect(verdict.note).toBe("另有 1 項示警");
  });

  test("只有路況事件、沒有天氣時，仍提示尚無天氣資料", () => {
    const route = makeRoute({ segments: [segment("士林區", [0, 10, 20])] });
    const stages = deriveStages(route);
    const event = { id: "e", kind: "event" as const, level: "caution" as const, startKm: 3, endKm: 3, label: "事故：交通事故" };
    const verdict = summarizeVerdict([event], stages);
    expect(verdict.level).toBe("caution");
    expect(verdict.note).toContain("尚無天氣資料");
  });

  test("路況事件服務完全失敗（eventsFailed=null）時，不可宣稱安全", () => {
    const route = makeRoute({ segments: [segment("士林區", [0, 10, 20], withWeather(10))] });
    const { stages, hazards } = hazardsOf(route);
    const verdict = summarizeVerdict(hazards, stages, { eventsFailed: null });
    expect(verdict.level).toBe("unknown");
    expect(verdict.note).toContain("路況事件暫時取不到");
  });

  test("路況事件部分縣市失敗時，不可宣稱安全", () => {
    const route = makeRoute({ segments: [segment("士林區", [0, 10, 20], withWeather(10))] });
    const { stages, hazards } = hazardsOf(route);
    const verdict = summarizeVerdict(hazards, stages, { eventsFailed: ["新北市"] });
    expect(verdict.level).toBe("unknown");
    expect(verdict.note).toContain("新北市路況事件取不到");
  });

  test("路況事件失敗但有示警時，示警等級優先", () => {
    const route = makeRoute({ segments: [segment("士林區", [0, 10, 20], withWeather(70))] });
    const { stages, hazards } = hazardsOf(route);
    const verdict = summarizeVerdict(hazards, stages, { eventsFailed: null });
    expect(verdict.level).toBe("risky");
    expect(verdict.note).toContain("路況事件暫時取不到");
  });

  test("eventsFailed 為空陣列時，可正常判定為安全", () => {
    const route = makeRoute({ segments: [segment("士林區", [0, 10, 20], withWeather(10))] });
    const { stages, hazards } = hazardsOf(route);
    const verdict = summarizeVerdict(hazards, stages, { eventsFailed: [] });
    expect(verdict.level).toBe("clear");
    expect(verdict.headline).toBe("沿途無示警");
  });

  test("未判定帶原因：沒有天氣資料為 no_data", () => {
    const route = makeRoute({ segments: [segment("士林區", [0, 10, 20])] });
    const { stages, hazards } = hazardsOf(route);
    expect(summarizeVerdict(hazards, stages).reasons).toEqual(["no_data"]);
  });

  test("路況事件取不到也算 no_data", () => {
    const route = makeRoute({ segments: [segment("士林區", [0, 10, 20], withWeather(10))] });
    const { stages, hazards } = hazardsOf(route);
    expect(summarizeVerdict(hazards, stages, { eventsFailed: null }).reasons).toEqual(["no_data"]);
  });

  test("預報過期時不可判安全，原因為 stale", () => {
    const route = makeRoute({ segments: [segment("士林區", [0, 10, 20], withWeather(10, { weatherStale: true }))] });
    const { stages, hazards } = hazardsOf(route);
    const verdict = summarizeVerdict(hazards, stages);
    expect(verdict.level).toBe("unknown");
    expect(verdict.reasons).toEqual(["stale"]);
    expect(verdict.headline).toBe("預報過期，無法確認安全");
  });

  test("超出預報時段時不可判安全，原因為 out_of_coverage", () => {
    const route = makeRoute({ segments: [segment("士林區", [0, 10, 20], withWeather(10, { outOfCoverage: true }))] });
    const { stages, hazards } = hazardsOf(route);
    const verdict = summarizeVerdict(hazards, stages);
    expect(verdict.level).toBe("unknown");
    expect(verdict.reasons).toEqual(["out_of_coverage"]);
  });

  test("多個原因依 no_data → stale → out_of_coverage 排列", () => {
    const route = makeRoute({
      segments: [
        segment("士林區", [0, 5], withWeather(10, { weatherStale: true, outOfCoverage: true })),
        segment("北投區", [10, 15, 20]),
      ],
    });
    const { stages, hazards } = hazardsOf(route);
    expect(summarizeVerdict(hazards, stages).reasons).toEqual(["no_data", "stale", "out_of_coverage"]);
  });

  test("預報過期但已有危險示警時，危險優先且不帶原因", () => {
    const route = makeRoute({ segments: [segment("士林區", [0, 10, 20], withWeather(70, { weatherStale: true }))] });
    const { stages, hazards } = hazardsOf(route);
    const verdict = summarizeVerdict(hazards, stages);
    expect(verdict.level).toBe("risky");
    expect(verdict.reasons).toBeUndefined();
  });
});

test.describe("buildCctvMarkers", () => {
  test("帶出行政區與未確認狀態，供標題與狀態燈使用", () => {
    const route = makeRoute();
    const [marker] = buildCctvMarkers(route, [{ ...CCTV_FEED, township: "士林區", status: "unknown" }]);
    expect(marker?.township).toBe("士林區");
    expect(marker?.status).toBe("unknown");
  });

  test("沒有鏡頭時回傳空陣列", () => {
    expect(buildCctvMarkers(makeRoute(), [])).toEqual([]);
  });
});
