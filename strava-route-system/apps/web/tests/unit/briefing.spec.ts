import { test, expect } from "@playwright/test";
import {
  applyWeather,
  briefRoute,
  districtKey,
  mapCwbCondition,
  pickAlternative,
  type DistrictWeather,
  type RouteBriefing,
} from "@/lib/dashboard/briefing";
import type { RainfallBucket } from "@/lib/cwb/forecast-eta";
import { makeRoute, segment, slopeProfile } from "../fixtures/route";

function weather(rain: number, extra: Partial<DistrictWeather> = {}): DistrictWeather {
  return {
    rainProbability: rain,
    windSpeedKmh: 5,
    temperature: 25,
    condition: "cloudy",
    periodLabel: "今天 12:00–18:00",
    ...extra,
  };
}

const lookupOf = (entries: Record<string, DistrictWeather>, county = "台北市") =>
  new Map(Object.entries(entries).map(([district, w]) => [districtKey(county, district), w]));

const bucket = (start: string, end: string, pop: number): RainfallBucket => ({
  startTime: `2026-10-01T${start}:00+08:00`,
  endTime: `2026-10-01T${end}:00+08:00`,
  pop,
  label: start,
  endLabel: end,
});

/** 08:00–10:00 降雨 10%、10:00–12:00 降雨 70% */
const MORNING_THEN_RAIN = [bucket("08:00", "10:00", 10), bucket("10:00", "12:00", 70)];
const AT_8AM = new Date("2026-10-01T08:00:00+08:00");

test.describe("applyWeather", () => {
  test("查得到的行政區帶入天氣並標 hasWeather，查不到的標 false", () => {
    const route = makeRoute({ segments: [segment("士林區", [0, 10]), segment("北投區", [20])] });
    const out = applyWeather(route, lookupOf({ 士林區: weather(70, { windSpeedKmh: 12 }) }));
    const [shilin, beitou] = out.segments;
    expect(shilin).toMatchObject({ rainProbability: 70, windSpeed: 12, hasWeather: true });
    expect(beitou!.hasWeather).toBe(false);
  });

  test("有出發時間時，各路段取起點 ETA 所在的時段（20 km/h）", () => {
    // 士林區 0 km → 08:00；北投區 40 km → 10:00，進入第二個時段
    const route = makeRoute({ distance: 50, segments: [segment("士林區", [0, 20]), segment("北投區", [40, 50])] });
    const lookup = lookupOf({
      士林區: weather(10, { rainfallBuckets: MORNING_THEN_RAIN }),
      北投區: weather(10, { rainfallBuckets: MORNING_THEN_RAIN }),
    });
    const out = applyWeather(route, lookup, { departureTime: AT_8AM });
    expect(out.segments.map((s) => s.rainProbability)).toEqual([10, 70]);
  });

  test("沒有出發時間時維持第一個時段", () => {
    const route = makeRoute({ segments: [segment("北投區", [40])] });
    const out = applyWeather(route, lookupOf({ 北投區: weather(10, { rainfallBuckets: MORNING_THEN_RAIN }) }));
    expect(out.segments[0]!.rainProbability).toBe(10);
  });
});

test.describe("mapCwbCondition", () => {
  test("sunny 對應 clear；未知字串退回 cloudy", () => {
    expect(mapCwbCondition("sunny")).toBe("clear");
    expect(mapCwbCondition("stormy")).toBe("stormy");
    expect(mapCwbCondition("foggy")).toBe("cloudy");
  });
});

test.describe("briefRoute", () => {
  test("陡坡不列入示警，也不影響今日判讀", () => {
    const route = makeRoute({
      elevationProfile: slopeProfile(0.2),
      segments: [segment("士林區", [0, 5, 10, 15, 20])],
    });
    const b = briefRoute(route, lookupOf({ 士林區: weather(10) }));
    expect(b.hazards).toHaveLength(0);
    expect(b.verdict.level).toBe("clear");
  });

  test("路線上的事故讓天氣良好的路線判為注意；施工只列出不影響判定", () => {
    const route = makeRoute({ segments: [segment("士林區", [0, 5, 10, 15, 20])] });
    const now = new Date("2026-09-27T12:00:00+08:00");
    const base = {
      description: "",
      lon: 121.55,
      source: "測試",
      effectiveTime: null,
      expireTime: null,
      updatedTime: null,
    };
    const work = { ...base, id: "work", type: 2, subType: 205, title: "道路施工", lat: 25.05 + 8 / 111 };
    const accident = { ...base, id: "acc", type: 1, subType: 101, title: "交通事故", lat: 25.05 + 5 / 111 };

    const onlyWork = briefRoute(route, lookupOf({ 士林區: weather(10) }), { events: [work], now });
    expect(onlyWork.verdict.level).toBe("clear");
    expect(onlyWork.roadEvents.map((e) => e.id)).toEqual(["work"]);

    const withAccident = briefRoute(route, lookupOf({ 士林區: weather(10) }), { events: [work, accident], now });
    expect(withAccident.verdict.level).toBe("caution");
    expect(withAccident.verdict.headline).toContain("事故：交通事故");
  });

  test("降雨達門檻判為危險，並帶出最高降雨與預報時段", () => {
    const route = makeRoute({ segments: [segment("士林區", [0, 5, 10, 15, 20])] });
    const b = briefRoute(route, lookupOf({ 士林區: weather(70) }));
    expect(b.verdict.level).toBe("risky");
    expect(b.maxRain).toBe(70);
    expect(b.periodLabel).toBe("今天 12:00–18:00");
  });

  test("遠端路段 ETA 落在下雨時段：判為危險，預報時段標示涵蓋實際用到的時段", () => {
    const route = makeRoute({ distance: 50, segments: [segment("士林區", [0, 20]), segment("北投區", [40, 50])] });
    const lookup = lookupOf({
      士林區: weather(10, { rainfallBuckets: MORNING_THEN_RAIN }),
      北投區: weather(10, { rainfallBuckets: MORNING_THEN_RAIN }),
    });
    const b = briefRoute(route, lookup, { now: AT_8AM });
    expect(b.verdict.level).toBe("risky");
    expect(b.maxRain).toBe(70);
    expect(b.periodLabel).toBe("08:00–12:00");
  });

  test("預報時段跨日：標出「明日」，不顯示成 18:00–18:00", () => {
    // 21:50 判讀、明日 03:50 出發；0 km 落在今晚 18:00–明日 06:00，80 km（07:50）落在明日 06:00–18:00
    const at = (iso: string) => new Date(`2026-10-${iso}:00+08:00`);
    const overnight: RainfallBucket[] = [
      { startTime: "2026-10-01T18:00:00+08:00", endTime: "2026-10-02T06:00:00+08:00", pop: 20, label: "18:00", endLabel: "06:00" },
      { startTime: "2026-10-02T06:00:00+08:00", endTime: "2026-10-02T18:00:00+08:00", pop: 20, label: "06:00", endLabel: "18:00" },
    ];
    const route = makeRoute({ distance: 90, segments: [segment("士林區", [0, 10]), segment("北投區", [80, 90])] });
    const lookup = lookupOf({
      士林區: weather(20, { rainfallBuckets: overnight }),
      北投區: weather(20, { rainfallBuckets: overnight }),
    });
    const now = at("01T21:50");
    expect(briefRoute(route, lookup, { now, departure: at("02T03:50") }).periodLabel).toBe("18:00–明日 18:00");
    // 起訖都在明日：日期只寫在開頭
    expect(briefRoute(route, lookup, { now, departure: at("02T06:30") }).periodLabel).toBe("明日 06:00–18:00");
  });

  test("指定出發時間：各段依該時間起算的 ETA 挑時段", () => {
    // 10:00 出發，0–20 km 落在 10:00–12:00 降雨 70%
    const route = makeRoute({ segments: [segment("士林區", [0, 20])] });
    const lookup = lookupOf({ 士林區: weather(10, { rainfallBuckets: MORNING_THEN_RAIN }) });
    const depart10 = new Date("2026-10-01T10:00:00+08:00");
    expect(briefRoute(route, lookup, { now: AT_8AM }).verdict.level).toBe("clear");
    const b = briefRoute(route, lookup, { now: AT_8AM, departure: depart10 });
    expect(b.verdict.level).toBe("risky");
    expect(b.departure).toBe(depart10.toISOString());
  });

  test("運動類型改變均速：健行較慢，遠端路段 ETA 落到下雨時段", () => {
    // 北投區 8–10 km：自行車 08:24–08:30 仍在 10%；健行 4 km/h → 10:00–10:30 落在 70%
    const route = makeRoute({ distance: 10, segments: [segment("士林區", [0, 2]), segment("北投區", [8, 10])] });
    const lookup = lookupOf({
      士林區: weather(10, { rainfallBuckets: MORNING_THEN_RAIN }),
      北投區: weather(10, { rainfallBuckets: MORNING_THEN_RAIN }),
    });
    const cycling = briefRoute(route, lookup, { now: AT_8AM });
    expect(cycling.activity).toBe("cycling");
    expect(cycling.speedKmh).toBe(20);
    expect(cycling.verdict.level).toBe("clear");
    const hiking = briefRoute(route, lookup, { now: AT_8AM, activity: "hiking" });
    expect(hiking.speedKmh).toBe(4);
    expect(hiking.verdict.level).toBe("risky");
  });

  test("未指定運動類型時依路線類型", () => {
    const route = { ...makeRoute({ segments: [segment("士林區", [0, 20])] }), type: "跑步" as const };
    expect(briefRoute(route, lookupOf({ 士林區: weather(10) }), { now: AT_8AM }).activity).toBe("running");
  });

  test("預報過期時為未判定，原因 stale", () => {
    const route = makeRoute({ segments: [segment("士林區", [0, 20])] });
    const b = briefRoute(route, lookupOf({ 士林區: weather(10, { stale: true }) }), { now: AT_8AM });
    expect(b.verdict.level).toBe("unknown");
    expect(b.verdict.reasons).toEqual(["stale"]);
  });

  test("路段 ETA 超出最後一個預報時段時為未判定，原因 out_of_coverage", () => {
    // 北投區出口 100 km → 13:00，超出 12:00 結束的預報
    const route = makeRoute({ distance: 100, segments: [segment("士林區", [0, 20]), segment("北投區", [40, 100])] });
    const lookup = lookupOf({
      士林區: weather(10, { rainfallBuckets: [bucket("08:00", "10:00", 10), bucket("10:00", "12:00", 10)] }),
      北投區: weather(10, { rainfallBuckets: [bucket("08:00", "10:00", 10), bucket("10:00", "12:00", 10)] }),
    });
    const b = briefRoute(route, lookup, { now: AT_8AM });
    expect(b.verdict.level).toBe("unknown");
    expect(b.verdict.reasons).toEqual(["out_of_coverage"]);
  });

  test("超出預報時段的路段不拿其他時段數值產生示警，也不列入最高降雨", () => {
    // 北投區 40–100 km → 10:00–13:00 超出 12:00；即使第二時段降雨 90% 也不能拿來判危險
    const route = makeRoute({ distance: 100, segments: [segment("士林區", [0, 20]), segment("北投區", [40, 100])] });
    const buckets = [bucket("08:00", "10:00", 10), bucket("10:00", "12:00", 90)];
    const lookup = lookupOf({
      士林區: weather(10, { rainfallBuckets: buckets }),
      北投區: weather(90, { rainfallBuckets: buckets, windSpeedKmh: 50 }),
    });
    const b = briefRoute(route, lookup, { now: AT_8AM });
    expect(b.verdict.level).toBe("unknown");
    expect(b.verdict.reasons).toEqual(["out_of_coverage"]);
    expect(b.hazards).toEqual([]);
    expect(b.maxRain).toBe(10);
    expect(b.segments[1]).toMatchObject({ hasWeather: true, outOfCoverage: true });
  });

  test("回傳合併天氣後的路段、此路線的事件失敗縣市與建議出發時段", () => {
    const route = makeRoute({ distance: 50, segments: [segment("士林區", [0, 20]), segment("北投區", [40, 50])] });
    const lookup = lookupOf({
      士林區: weather(10, { rainfallBuckets: MORNING_THEN_RAIN }),
      北投區: weather(10, { rainfallBuckets: MORNING_THEN_RAIN }),
    });
    const b = briefRoute(route, lookup, { now: AT_8AM, eventsFailed: ["新北市", "台北市"] });
    expect(b.segments.every((s) => s.hasWeather)).toBe(true);
    expect(b.eventsFailed).toEqual(["台北市"]);
    expect(briefRoute(route, lookup, { now: AT_8AM, eventsFailed: null }).eventsFailed).toBeNull();
  });

  test("ETA 都在預報時段內且資料新，可判安全", () => {
    const route = makeRoute({ distance: 50, segments: [segment("士林區", [0, 20]), segment("北投區", [40, 50])] });
    const buckets = [bucket("08:00", "10:00", 10), bucket("10:00", "12:00", 10)];
    const lookup = lookupOf({ 士林區: weather(10, { rainfallBuckets: buckets }), 北投區: weather(10, { rainfallBuckets: buckets }) });
    expect(briefRoute(route, lookup, { now: AT_8AM }).verdict.level).toBe("clear");
  });

  test("完全沒有天氣資料時為未判定，數值為 null", () => {
    const route = makeRoute({ segments: [segment("士林區", [0, 20])] });
    const b = briefRoute(route, new Map());
    expect(b.verdict.level).toBe("unknown");
    expect(b.maxRain).toBeNull();
    expect(b.temperature).toBeNull();
  });

  test("路況事件服務整個失敗時，天氣良好也判為未判定", () => {
    const route = makeRoute({ segments: [segment("士林區", [0, 10, 20])] });
    const b = briefRoute(route, lookupOf({ 士林區: weather(10) }), { eventsFailed: null });
    expect(b.verdict.level).toBe("unknown");
    expect(b.verdict.note).toContain("路況事件暫時取不到");
  });

  test("路況事件失敗的縣市在路線上（新舊縣名、台臺皆可對上）時判為未判定", () => {
    const route = makeRoute({ segments: [segment("士林區", [0, 10, 20])] });
    const b = briefRoute(route, lookupOf({ 士林區: weather(10) }), { eventsFailed: ["臺北市"] });
    expect(b.verdict.level).toBe("unknown");
  });

  test("路況事件失敗的縣市不在這條路線上時，不影響判定", () => {
    const route = makeRoute({ segments: [segment("士林區", [0, 10, 20])] });
    const b = briefRoute(route, lookupOf({ 士林區: weather(10) }), { eventsFailed: ["宜蘭縣"] });
    expect(b.verdict.level).toBe("clear");
  });

  test("路況事件失敗但天氣已達危險時，仍判為危險", () => {
    const route = makeRoute({ segments: [segment("士林區", [0, 10, 20])] });
    const b = briefRoute(route, lookupOf({ 士林區: weather(70) }), { eventsFailed: null });
    expect(b.verdict.level).toBe("risky");
    expect(b.verdict.note).toContain("路況事件暫時取不到");
  });
});

test.describe("pickAlternative", () => {
  const lookup = lookupOf({ 士林區: weather(70), 北投區: weather(45), 內湖區: weather(0) });
  const brief = (id: string, district: string, distance = 20) =>
    briefRoute(makeRoute({ id, distance, segments: [segment(district, [0, 5, 10, 15, distance])] }), lookup);

  const risky = brief("risky", "士林區");
  const caution = brief("caution", "北投區");
  const clearLong = brief("clear-long", "內湖區", 20);
  const clearShort = brief("clear-short", "內湖區", 10);

  test("挑出比目前更安全的路線中最安全、再比距離短者", () => {
    expect(pickAlternative(risky, [risky, caution, clearLong, clearShort])?.id).toBe("clear-short");
  });

  test("只有同級或更危險的路線時不推薦", () => {
    expect(pickAlternative(caution, [caution, risky])).toBeNull();
  });

  const inCounty = (b: RouteBriefing, id: string, county: string): RouteBriefing => ({
    ...b,
    id,
    segments: b.segments.map((seg) => ({ ...seg, county })),
  });

  test("不跨縣市推薦：只考慮經過同一縣市的路線", () => {
    const tainan = inCounty(clearShort, "tainan", "台南市");
    expect(pickAlternative(risky, [risky, tainan])).toBeNull();
    expect(pickAlternative(risky, [risky, tainan, caution])?.id).toBe("caution");
  });

  test("縣市舊名視為同一縣市（台北縣＝新北市）", () => {
    const current = inCounty(risky, "ntpc", "新北市");
    const oldName = inCounty(clearShort, "old-name", "台北縣");
    expect(pickAlternative(current, [current, oldName])?.id).toBe("old-name");
  });

  test("目前路線已安全或未判定時不推薦", () => {
    const unknown = briefRoute(makeRoute({ id: "u", segments: [segment("萬華區", [0, 20])] }), lookup);
    expect(pickAlternative(clearLong, [clearLong, clearShort])).toBeNull();
    expect(pickAlternative(unknown, [unknown, clearShort])).toBeNull();
  });
});

test.describe("風速與健行爬升依 ETA", () => {
  test("風速依路段 ETA 挑時段：早段風小、晚段到達時起強風才示警", () => {
    const route = makeRoute({ distance: 60, segments: [segment("士林區", [0, 20]), segment("北投區", [40, 60])] });
    const wind = [
      { startTime: "2026-10-01T08:00:00+08:00", endTime: "2026-10-01T10:00:00+08:00", kmh: 10 },
      { startTime: "2026-10-01T10:00:00+08:00", endTime: "2026-10-01T12:00:00+08:00", kmh: 55 },
    ];
    const w = (rain: number) => weather(rain, { windSpeedKmh: 10, windBuckets: wind, rainfallBuckets: [bucket("08:00", "12:00", 10)] });
    const b = briefRoute(route, lookupOf({ 士林區: w(10), 北投區: w(10) }), { now: AT_8AM });
    expect(b.segments[0]!.windSpeed).toBe(10);
    expect(b.segments[1]!.windSpeed).toBe(55);
    expect(b.verdict.level).toBe("risky");
    expect(b.verdict.headline).toContain("風速 55 km/h");
    // 示警只在後段（前段 0–20 km 風速 10）
    expect(b.hazards.every((h) => h.startKm > 20)).toBe(true);
  });

  test("健行爬升讓後段晚到：同樣的路線，健行比不計爬升晚進入下雨時段", () => {
    // 0–8 km 爬升 1200 m；後段 8–10 km
    const route = makeRoute({
      distance: 10,
      elevationProfile: [[0, 0], [8, 1200], [10, 1200]],
      segments: [segment("士林區", [0, 2]), segment("北投區", [8, 10])],
    });
    // 08:00–12:00 降雨 10%、12:00–16:00 降雨 70%
    const buckets = [bucket("08:00", "12:00", 10), bucket("12:00", "16:00", 70)];
    const lookup = lookupOf({ 士林區: weather(10, { rainfallBuckets: buckets }), 北投區: weather(10, { rainfallBuckets: buckets }) });
    // 健行 4 km/h：8 km = 2 h，再加爬升 1200 m = 2 h → 12:00 到 8 km，落在下雨時段
    const b = briefRoute(route, lookup, { now: AT_8AM, activity: "hiking" });
    expect(b.verdict.level).toBe("risky");
  });
});

test.describe("建議出發時段", () => {
  // 20 km、自行車 20 km/h：全程 1 小時
  const route = makeRoute({ segments: [segment("士林區", [0, 20])] });
  const at = (hhmm: string) => new Date(`2026-10-01T${hhmm}:00+08:00`).toISOString();

  test("現在出發天氣最好：區間從現在開始，到會碰上下雨時段前為止", () => {
    // 08:00–10:00 降雨 10%、10:00–12:00 降雨 70%；09:00 出發會在 10:00 進入下雨時段
    const b = briefRoute(route, lookupOf({ 士林區: weather(10, { rainfallBuckets: MORNING_THEN_RAIN }) }), { now: AT_8AM, suggest: true });
    expect(b.departureSuggestion).toEqual({ from: at("08:00"), to: at("08:30"), level: null, nowIsBest: true });
  });

  test("現在出發會淋雨：建議較晚、沿途無天氣示警的時段", () => {
    const rainThenClear = [bucket("08:00", "10:00", 70), bucket("10:00", "12:00", 10)];
    const b = briefRoute(route, lookupOf({ 士林區: weather(70, { rainfallBuckets: rainThenClear }) }), { now: AT_8AM, suggest: true });
    expect(b.verdict.level).toBe("risky");
    expect(b.departureSuggestion).toMatchObject({ from: at("10:00"), level: null, nowIsBest: false });
  });

  test("沒開啟時不試算（只有畫面會顯示的路線才算）", () => {
    const b = briefRoute(route, lookupOf({ 士林區: weather(10, { rainfallBuckets: MORNING_THEN_RAIN }) }), { now: AT_8AM });
    expect(b.departureSuggestion).toBeNull();
  });

  test("即時雨量只影響一小時內出發，較晚出發只看預報", () => {
    // 現在路線旁測站實測中雨；預報整天降雨 10%
    const clear = [bucket("08:00", "14:00", 10), bucket("14:00", "20:00", 10)];
    const lookup = lookupOf({ 士林區: weather(10, { rainfallBuckets: clear, observedRainMmPerHr: 3 }) });
    const b = briefRoute(route, lookup, { now: AT_8AM, suggest: true });
    expect(b.verdict.level).toBe("risky");
    expect(b.departureSuggestion).toMatchObject({ from: at("09:30"), level: null, nowIsBest: false });
  });

  test("天氣資料不足或過期時不建議（未判定不可拿來推薦）", () => {
    expect(briefRoute(route, new Map(), { now: AT_8AM, suggest: true }).departureSuggestion).toBeNull();
    const stale = lookupOf({ 士林區: weather(10, { rainfallBuckets: MORNING_THEN_RAIN, stale: true }) });
    expect(briefRoute(route, stale, { now: AT_8AM, suggest: true }).departureSuggestion).toBeNull();
  });

  test("路況事件取不到不影響天氣建議，但判定仍為未判定", () => {
    const b = briefRoute(route, lookupOf({ 士林區: weather(10, { rainfallBuckets: MORNING_THEN_RAIN }) }), {
      now: AT_8AM,
      eventsFailed: null,
      suggest: true,
    });
    expect(b.verdict.level).toBe("unknown");
    expect(b.departureSuggestion?.nowIsBest).toBe(true);
  });
});
