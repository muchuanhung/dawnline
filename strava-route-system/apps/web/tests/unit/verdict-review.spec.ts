/**
 * 凍結前 code review 第 ② 輪（判讀規則）的回歸測試：缺值、超出時段、看不懂的資料一律不可判成安全。
 */
import { test, expect } from "@playwright/test";
import { briefRoute, conditionFromWeatherText, districtKey, type DistrictWeather } from "@/lib/dashboard/briefing";
import { popBuckets } from "@/lib/cwb/district-weather.server";
import { parseRainfallStations, STATION_MAX_AGE_MS } from "@/lib/cwb/rainfall-stations";
import { buildRoutePolylineKm, computeHazards, deriveStages, summarizeVerdict } from "@/lib/routes/recon-geo";
import { eventHazards, matchEventsToRoute, parseTdxEvent, wktPoints } from "@/lib/routes/road-events";
import { makeRoute, segment, withWeather } from "../fixtures/route";

const AT_8AM = new Date("2026-10-01T08:00:00+08:00");
const t = (hhmm: string) => `2026-10-01T${hhmm}:00+08:00`;

test.describe("① 降雨機率缺值不可當成 0%", () => {
  const time = (start: string, end: string, pop: string) => ({
    StartTime: t(start),
    EndTime: t(end),
    ElementValue: [{ ProbabilityOfPrecipitation: pop }],
  });

  test("連續可用的時段照常解析", () => {
    const buckets = popBuckets([time("06:00", "09:00", "10"), time("09:00", "12:00", "70")]);
    expect(buckets.map((b) => b.pop)).toEqual([10, 70]);
  });

  test("遇到空白、「-」或非數字就停，不跳過缺值往後接", () => {
    for (const missing of [" ", "", "-", "abc"]) {
      const buckets = popBuckets([time("06:00", "09:00", "10"), time("09:00", "12:00", missing), time("12:00", "15:00", "90")]);
      expect(buckets.map((b) => b.pop)).toEqual([10]);
    }
  });

  test("第一個時段就缺值：一個都不採用", () => {
    expect(popBuckets([time("06:00", "09:00", "-")])).toEqual([]);
  });
});

test.describe("② 線狀、多點的路況事件也要對到路線", () => {
  // 測試路線往北直走 20 km：lat = 25.05 + km / 111，lon = 121.55
  const latAtKm = (km: number) => 25.05 + km / 111;
  const polyline = buildRoutePolylineKm(makeRoute());
  const NOW = new Date("2026-09-27T12:00:00+08:00");

  test("WKT 各種幾何都取出所有頂點（經度 緯度 → [lat, lon]）", () => {
    expect(wktPoints("POINT(121.5 25.1)")).toEqual([[25.1, 121.5]]);
    expect(wktPoints("LINESTRING(121.5 25.1, 121.6 25.2)")).toEqual([
      [25.1, 121.5],
      [25.2, 121.6],
    ]);
    expect(wktPoints("MULTIPOINT((121.5 25.1),(121.6 25.2))")).toHaveLength(2);
    expect(wktPoints("MULTILINESTRING((121.5 25.1, 121.6 25.2),(121.7 25.3, 121.8 25.4))")).toHaveLength(4);
    expect(wktPoints("")).toEqual([]);
  });

  test("線狀坍方：起點在遠處、終點在路線上，仍判危險", () => {
    // 起點在路線東邊約 2 km，終點落在路線第 8 km
    const raw = {
      EventID: "slide",
      EventType: 6,
      EventSubType: 601,
      EventTitle: "坍方",
      Positions: `LINESTRING(121.57 ${latAtKm(8)}, 121.55 ${latAtKm(8)})`,
    };
    const e = parseTdxEvent(raw)!;
    expect(e.points).toHaveLength(2);
    const matched = matchEventsToRoute([e], polyline, { now: NOW });
    expect(matched).toHaveLength(1);
    expect(matched[0]!.km).toBeCloseTo(8, 1);
    expect(eventHazards(matched)).toMatchObject([{ level: "risky" }]);
  });

  test("不認得的事件類型判注意，不可當成不影響", () => {
    const e = parseTdxEvent({ EventID: "x", EventType: 0, Positions: `POINT(121.55 ${latAtKm(5)})` })!;
    const matched = matchEventsToRoute([e], polyline, { now: NOW });
    expect(matched[0]).toMatchObject({ category: "other", affectsVerdict: true });
    expect(eventHazards(matched)).toMatchObject([{ level: "caution" }]);
  });
});

test.describe("③ 雷雨、有雨依騎經時段判斷", () => {
  test("天氣現象文字 → condition", () => {
    expect(conditionFromWeatherText("午後短暫雷陣雨")).toBe("stormy");
    expect(conditionFromWeatherText("多雲、短暫陣雨")).toBe("rainy");
    expect(conditionFromWeatherText("多雲時晴")).toBe("cloudy");
    expect(conditionFromWeatherText(undefined)).toBeNull();
  });

  const weather: DistrictWeather = {
    rainProbability: 20,
    windSpeedKmh: 5,
    temperature: 25,
    condition: "cloudy",
    periodLabel: null,
    rainfallBuckets: [
      { startTime: t("06:00"), endTime: t("12:00"), pop: 20, label: "06:00", endLabel: "12:00" },
      { startTime: t("12:00"), endTime: t("18:00"), pop: 30, label: "12:00", endLabel: "18:00" },
    ],
    windBuckets: [{ startTime: t("06:00"), endTime: t("18:00"), kmh: 5 }],
    weatherTextBuckets: [
      { startTime: t("06:00"), endTime: t("12:00"), text: "多雲" },
      { startTime: t("12:00"), endTime: t("18:00"), text: "午後短暫雷陣雨" },
    ],
  };
  const route = makeRoute({ segments: [segment("士林區", [0, 10, 20])] });
  const lookup = new Map([[districtKey("台北市", "士林區"), weather]]);

  test("現在多雲、下午才有雷雨：早上出發不示警，下午出發判危險", () => {
    const morning = briefRoute(route, lookup, { now: AT_8AM });
    expect(morning.verdict.level).toBe("clear");
    const afternoon = briefRoute(route, lookup, { now: AT_8AM, departure: new Date(t("13:00")) });
    expect(afternoon.hazards.map((h) => h.kind)).toContain("storm");
    expect(afternoon.verdict.level).toBe("risky");
  });
});

test.describe("④ 風速超出預報時段：不拿現在的風速頂替", () => {
  test("降雨機率涵蓋到 18:00、風速只到 09:00：之後抵達的路段算超出預報時段", () => {
    const weather: DistrictWeather = {
      rainProbability: 10,
      windSpeedKmh: 5,
      temperature: 25,
      condition: "cloudy",
      periodLabel: null,
      rainfallBuckets: [{ startTime: t("06:00"), endTime: t("18:00"), pop: 10, label: "06:00", endLabel: "18:00" }],
      windBuckets: [{ startTime: t("06:00"), endTime: t("09:00"), kmh: 5 }],
    };
    const route = makeRoute({ segments: [segment("士林區", [0, 10, 20])] });
    const b = briefRoute(route, new Map([[districtKey("台北市", "士林區"), weather]]), {
      now: AT_8AM,
      departure: new Date(t("10:00")),
    });
    expect(b.verdict.level).toBe("unknown");
    expect(b.verdict.reasons).toContain("out_of_coverage");
  });
});

test.describe("⑤ 已有示警時，也要說出哪些路段沒判讀到", () => {
  test("一段注意、一段超出預報時段：等級照示警，說明加註", () => {
    const route = makeRoute({
      segments: [
        segment("士林區", [0, 5], withWeather(45)),
        segment("北投區", [15, 20], withWeather(0, { outOfCoverage: true })),
      ],
    });
    const stages = deriveStages(route);
    const verdict = summarizeVerdict(computeHazards(route, stages), stages);
    expect(verdict.level).toBe("caution");
    expect(verdict.note).toContain("部分路段超出預報時段");
  });

  test("預報過期也加註", () => {
    const route = makeRoute({
      segments: [
        segment("士林區", [0, 5], withWeather(45)),
        segment("北投區", [15, 20], withWeather(0, { weatherStale: true })),
      ],
    });
    const stages = deriveStages(route);
    expect(summarizeVerdict(computeHazards(route, stages), stages).note).toContain("部分路段預報過期");
  });
});

test.describe("⑧ 雨量站觀測時間過舊就不採用", () => {
  const NOW = Date.parse(t("08:00"));
  const station = (obsTime: string | undefined, mm: number) => ({
    ...(obsTime ? { ObsTime: { DateTime: obsTime } } : {}),
    GeoInfo: { CountyName: "臺北市", Coordinates: [{ CoordinateName: "WGS84", StationLatitude: 25.1, StationLongitude: 121.5 }] },
    RainfallElement: { Past1hr: { Precipitation: mm } },
  });

  test("超過 70 分鐘的測站略過；新的與沒有時間的舊格式照舊採用", () => {
    const old = new Date(NOW - STATION_MAX_AGE_MS - 60_000).toISOString();
    const fresh = new Date(NOW - 10 * 60_000).toISOString();
    const raw = { records: { Station: [station(old, 9), station(fresh, 1), station(undefined, 2)] } };
    expect(parseRainfallStations(raw, "臺北市", NOW).map((s) => s.mmPerHr)).toEqual([1, 2]);
    // 沒有提供 now 時不篩（舊呼叫端的行為）
    expect(parseRainfallStations(raw, "臺北市")).toHaveLength(3);
  });
});
