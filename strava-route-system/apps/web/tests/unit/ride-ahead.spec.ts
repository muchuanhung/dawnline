/**
 * 途中模式「從我現在位置往前看」：定位 → 里程、從目前里程起算 ETA、只判讀前方路段
 */
import { test, expect } from "@playwright/test";
import { briefRoute, districtKey, type DistrictWeather } from "@/lib/dashboard/briefing";
import { departureForPosition, estimateArrivalTime, type RainfallBucket } from "@/lib/cwb/forecast-eta";
import {
  buildRoutePolylineKm,
  clipRouteFrom,
  clipStagesFrom,
  deriveStages,
  locateOnRoute,
  POSITION_MAX_ACCURACY_M,
  type RoutePolylineKm,
} from "@/lib/routes/recon-geo";
import { paceFor, parseFromKm } from "@/lib/routes/trip";
import { flatProfile, makeRoute, segment, slopeProfile } from "../fixtures/route";

const KM_PER_DEG_LAT = 111;
const LON = 121.55;
const at = (hhmm: string) => new Date(`2026-10-01T${hhmm}:00+08:00`);

function weather(rain: number, extra: Partial<DistrictWeather> = {}): DistrictWeather {
  return { rainProbability: rain, windSpeedKmh: 5, temperature: 25, condition: "cloudy", periodLabel: null, ...extra };
}
const lookupOf = (entries: Record<string, DistrictWeather>) =>
  new Map(Object.entries(entries).map(([district, w]) => [districtKey("台北市", district), w]));
const bucket = (start: string, end: string, pop: number): RainfallBucket => ({
  startTime: `2026-10-01T${start}:00+08:00`,
  endTime: `2026-10-01T${end}:00+08:00`,
  pop,
  label: start,
  endLabel: end,
});

test.describe("departureForPosition", () => {
  test("均速：在 4 km 處、10:00 → 反推 09:00 出發", () => {
    expect(departureForPosition(at("10:00"), 4, 4).toISOString()).toBe(at("09:00").toISOString());
  });

  test("健行爬升修正：前方 ETA 是 hoursTo(k) − hoursTo(目前里程)，不是剩餘距離 ÷ 均速", () => {
    // 5–6 km 爬升 200 m；從 4 km 走到 8 km：4 km ÷ 4 km/h = 60 分鐘，加爬升 200 m × 10 分鐘/100 m = 20 分鐘
    const pace = paceFor("hiking", slopeProfile(0.2, 5, 10));
    const now = at("10:00");
    const eta = estimateArrivalTime(8, departureForPosition(now, 4, pace), pace);
    expect((eta.getTime() - now.getTime()) / 60_000).toBeCloseTo(80, 5);
  });
});

/** 往北直線：km 對應的座標 */
const north = (km: number, lonOffsetKm = 0) => ({
  lat: 25.05 + km / KM_PER_DEG_LAT,
  lon: LON + lonOffsetKm / (KM_PER_DEG_LAT * Math.cos((25.05 * Math.PI) / 180)),
});

/** 往北 5 km 再沿原路折返的往返路線 */
function outAndBack(): RoutePolylineKm {
  const points: [number, number][] = [];
  const cumulativeKm: number[] = [];
  for (let i = 0; i <= 100; i++) {
    const along = i / 10;
    const p = north(along <= 5 ? along : 10 - along);
    points.push([p.lat, p.lon]);
    cumulativeKm.push(along);
  }
  return { points, cumulativeKm };
}

test.describe("locateOnRoute", () => {
  const polyline = buildRoutePolylineKm(makeRoute({ elevationProfile: flatProfile(10) }));
  const fix = (km: number, accuracyM = 20, lonOffsetKm = 0) => ({ ...north(km, lonOffsetKm), accuracyM });

  test("路線上：回傳里程與離路距離", () => {
    const r = locateOnRoute(fix(3.2), polyline);
    expect(r.status).toBe("on_route");
    if (r.status === "on_route") {
      expect(r.km).toBeCloseTo(3.2, 2);
      expect(r.distKm).toBeCloseTo(0, 3);
    }
  });

  test("精度太差：不換算里程", () => {
    expect(locateOnRoute(fix(3, POSITION_MAX_ACCURACY_M + 1), polyline)).toEqual({
      status: "inaccurate",
      accuracyM: POSITION_MAX_ACCURACY_M + 1,
    });
    // 精度不明（NaN）也不可當成準確
    expect(locateOnRoute(fix(3, Number.NaN), polyline).status).toBe("inaccurate");
  });

  test("離路線 500 m：不在路線上", () => {
    const r = locateOnRoute(fix(3, 20, 0.5), polyline);
    expect(r.status).toBe("off_route");
  });

  test("沒有 polyline", () => {
    expect(locateOnRoute(fix(3), null)).toEqual({ status: "no_route" });
  });

  test("往返路線：同一點對到去程與回程，沒有上次里程時讓使用者選", () => {
    expect(locateOnRoute(fix(2), outAndBack())).toEqual({ status: "ambiguous", candidates: [2, 8] });
  });

  test("往返路線：有上次里程時取不早於上次里程的那一次經過", () => {
    const early = locateOnRoute(fix(2), outAndBack(), { previousKm: 1 });
    const late = locateOnRoute(fix(2), outAndBack(), { previousKm: 6 });
    expect(early.status === "on_route" && Math.round(early.km * 10) / 10).toBe(2);
    expect(late.status === "on_route" && Math.round(late.km * 10) / 10).toBe(8);
  });

  test("之字形：相鄰兩段相距 200 m，精度 20 m 時只對到所在的那段", () => {
    // 往北 3 km、往東 200 m、再往南 3 km
    const points: [number, number][] = [];
    const cumulativeKm: number[] = [];
    for (let i = 0; i <= 30; i++) {
      const p = north(i / 10);
      points.push([p.lat, p.lon]);
      cumulativeKm.push(i / 10);
    }
    for (let i = 0; i <= 30; i++) {
      const p = north(3 - i / 10, 0.2);
      points.push([p.lat, p.lon]);
      cumulativeKm.push(3.2 + i / 10);
    }
    const r = locateOnRoute(fix(1), { points, cumulativeKm });
    expect(r.status).toBe("on_route");
    if (r.status === "on_route") expect(r.km).toBeCloseTo(1, 2);
  });
});

test.describe("clipRouteFrom / clipStagesFrom", () => {
  // 士林區取樣 0、2 km，北投區 8、10 km；兩區交界在 5 km
  const route = makeRoute({ distance: 10, elevationProfile: flatProfile(10), segments: [segment("士林區", [0, 2]), segment("北投區", [8, 10])] });

  test("位置在交界前：目前所在的士林區以目前里程保留", () => {
    const clipped = clipRouteFrom(route, 4);
    expect(clipped.segments.map((s) => [s.districtZh, s.sampleKms])).toEqual([
      ["士林區", [4]],
      ["北投區", [8, 10]],
    ]);
    const stages = clipStagesFrom(deriveStages(clipped), 4);
    expect(stages.map((s) => [s.name, s.startKm])).toEqual([
      ["士林區", 4],
      ["北投區", 6],
    ]);
  });

  test("位置過了交界：已走完的士林區移除", () => {
    expect(clipRouteFrom(route, 6).segments.map((s) => [s.districtZh, s.sampleKms])).toEqual([["北投區", [6, 8, 10]]]);
  });

  test("0 km 原樣回傳", () => {
    expect(clipRouteFrom(route, 0)).toBe(route);
  });
});

test.describe("briefRoute fromKm（途中模式）", () => {
  const route = makeRoute({
    distance: 10,
    elevationProfile: flatProfile(10),
    segments: [segment("士林區", [0, 2]), segment("北投區", [8, 10])],
  });

  test("已走過的路段下雨不列入判定", () => {
    const lookup = lookupOf({ 士林區: weather(70), 北投區: weather(10) });
    expect(briefRoute(route, lookup, { now: at("08:00") }).verdict.level).toBe("risky");
    const ahead = briefRoute(route, lookup, { now: at("08:00"), fromKm: 6 });
    expect(ahead.verdict.level).toBe("clear");
    expect(ahead.hazards).toEqual([]);
    expect(ahead.maxRain).toBe(10);
    expect(ahead.fromKm).toBe(6);
  });

  test("目前所在路段仍列入判定，示警從目前里程起算", () => {
    const lookup = lookupOf({ 士林區: weather(70), 北投區: weather(10) });
    const ahead = briefRoute(route, lookup, { now: at("08:00"), fromKm: 4 });
    expect(ahead.verdict.level).toBe("risky");
    expect(ahead.verdict.headline).toBe("4.0 km 起降雨 70%");
  });

  test("健行：以「現在」為抵達目前里程的時間挑預報時段，並回傳反推的出發時間", () => {
    // 08–10 降雨 10%、10–12 降雨 70%
    const buckets = [bucket("08:00", "10:00", 10), bucket("10:00", "12:00", 70)];
    const lookup = lookupOf({ 士林區: weather(10, { rainfallBuckets: buckets }), 北投區: weather(10, { rainfallBuckets: buckets }) });
    // 08:00 從起點出發：北投區 8 km 10:00 抵達 → 70%
    expect(briefRoute(route, lookup, { now: at("08:00"), activity: "hiking" }).verdict.level).toBe("risky");
    // 08:00 已在 4 km：北投區 09:00–09:30 抵達 → 10%
    const ahead = briefRoute(route, lookup, { now: at("08:00"), activity: "hiking", fromKm: 4, suggest: true });
    expect(ahead.verdict.level).toBe("clear");
    expect(ahead.departure).toBe(at("07:00").toISOString());
    // 已經出發，不試算建議出發時段
    expect(ahead.departureSuggestion).toBeNull();
  });

  test("前方超出預報時段：未判定，不可判為安全", () => {
    const buckets = [bucket("08:00", "10:00", 10), bucket("10:00", "12:00", 10)];
    const lookup = lookupOf({ 士林區: weather(10, { rainfallBuckets: buckets }), 北投區: weather(10, { rainfallBuckets: buckets }) });
    // 11:00 在 4 km，健行到 10 km 是 12:30，超出 12:00
    const ahead = briefRoute(route, lookup, { now: at("11:00"), activity: "hiking", fromKm: 4 });
    expect(ahead.verdict.level).toBe("unknown");
    expect(ahead.verdict.reasons).toContain("out_of_coverage");
  });

  test("已走過的路況事件不列入", () => {
    const now = at("12:00");
    const base = { description: "", lon: LON, source: "測試", effectiveTime: null, expireTime: null, updatedTime: null };
    const accident = { ...base, id: "acc", type: 1, subType: 101, title: "交通事故", lat: north(3).lat };
    const lookup = lookupOf({ 士林區: weather(10), 北投區: weather(10) });
    expect(briefRoute(route, lookup, { now, events: [accident] }).verdict.level).toBe("caution");
    const ahead = briefRoute(route, lookup, { now, events: [accident], fromKm: 4 });
    expect(ahead.verdict.level).toBe("clear");
    expect(ahead.roadEvents).toEqual([]);
  });

  test("超過總里程時以終點計；0 或未提供時為整條路線", () => {
    const lookup = lookupOf({ 士林區: weather(10), 北投區: weather(10) });
    expect(briefRoute(route, lookup, { now: at("08:00"), fromKm: 99 }).fromKm).toBe(10);
    expect(briefRoute(route, lookup, { now: at("08:00"), fromKm: 0 }).fromKm).toBeNull();
    expect(briefRoute(route, lookup, { now: at("08:00") }).fromKm).toBeNull();
  });
});

test.describe("parseFromKm", () => {
  test("只接受非負有限數字", () => {
    expect(parseFromKm("5.25")).toBe(5.25);
    expect(parseFromKm("0")).toBe(0);
    expect(parseFromKm("-1")).toBeNull();
    expect(parseFromKm("abc")).toBeNull();
    expect(parseFromKm("Infinity")).toBeNull();
    expect(parseFromKm(null)).toBeNull();
  });
});
