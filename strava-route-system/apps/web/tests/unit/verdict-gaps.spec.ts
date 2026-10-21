/**
 * 四個判定缺口的回歸測試：
 * 1. TDX 事件取不到（eventsFailed）→ unknown
 * 2. 部分路段無天氣 → unknown
 * 3. ETA 對到正確的 F-D0047 時段
 * 4. 即時雨量只取路線 3 km 內測站
 */

import { readFileSync } from "node:fs";
import { test, expect } from "@playwright/test";
import {
  applyWeather,
  briefRoute,
  districtKey,
  mapCwbCondition,
  routeDistrictPoints,
  withRouteObservedRain,
  type DistrictWeather,
} from "@/lib/dashboard/briefing";
import {
  getCountyRainfallStations,
  getDistrictWeather,
  type CWBWeatherResponse,
} from "@/lib/cwb/district-weather.server";
import { encodePolyline } from "@/lib/routes/polyline";
import { flatProfile, makeRoute, segment } from "../fixtures/route";

const loadFixture = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf8"));

const F_D0047 = loadFixture("cwb-f-d0047.json");
const O_A0002 = loadFixture("cwb-o-a0002.json");

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

/** 以 URL 分派 CWB 各資料集的回應；不發真正的網路請求 */
function stubCwbFetch() {
  const original = globalThis.fetch;
  const originalKey = process.env.CWB_API_KEY;
  process.env.CWB_API_KEY = "test-key";
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    const body = url.includes("/F-D0047-") ? F_D0047 : url.includes("/O-A0002-") ? O_A0002 : {};
    return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  return () => {
    globalThis.fetch = original;
    if (originalKey === undefined) delete process.env.CWB_API_KEY;
    else process.env.CWB_API_KEY = originalKey;
  };
}

/** 與 get-briefing.server.ts 相同的 CWB 回應 → DistrictWeather 轉換 */
function toDistrictWeather(w: CWBWeatherResponse): DistrictWeather {
  const first = w.rainfall12h[0];
  return {
    rainProbability: first?.pop ?? 0,
    windSpeedKmh: w.windSpeedKmh,
    temperature: w.temperature,
    condition: mapCwbCondition(w.condition),
    periodLabel: first ? `${first.label}–${first.endLabel}` : null,
    rainfallBuckets: w.rainfall12h,
  };
}

test.describe("缺口 1：TDX 事件取不到 → unknown", () => {
  test("跨縣市路線只有其中一個縣市事件失敗，天氣良好也判為未判定", () => {
    const route = makeRoute({
      segments: [segment("信義區", [0, 5, 10]), segment("新店區", [15, 20], { county: "新北市" })],
    });
    const lookup = new Map([
      [districtKey("台北市", "信義區"), weather(10)],
      [districtKey("新北市", "新店區"), weather(10)],
    ]);

    const ok = briefRoute(route, lookup, { eventsFailed: [] });
    expect(ok.verdict.level).toBe("clear");

    const b = briefRoute(route, lookup, { eventsFailed: ["新北市", "宜蘭縣"] });
    expect(b.verdict.level).toBe("unknown");
    expect(b.verdict.note).toContain("新北市路況事件取不到");
    expect(b.verdict.note).not.toContain("宜蘭縣");
  });
});

test.describe("缺口 2：部分路段無天氣 → unknown", () => {
  test("一個行政區有天氣、另一個查不到時判為未判定，最高降雨只計有資料的路段", () => {
    const route = makeRoute({ segments: [segment("士林區", [0, 5, 10]), segment("北投區", [15, 20])] });
    const b = briefRoute(route, new Map([[districtKey("台北市", "士林區"), weather(10)]]));
    expect(b.verdict.level).toBe("unknown");
    expect(b.verdict.note).toContain("部分路段無天氣資料");
    expect(b.maxRain).toBe(10);
  });
});

test.describe("缺口 3：ETA 對到正確的 F-D0047 時段", () => {
  let restore: () => void;
  test.beforeEach(() => {
    restore = stubCwbFetch();
  });
  test.afterEach(() => restore());

  test("F-D0047 解析出的 3 小時時段，依各路段 ETA（20 km/h）挑選", async () => {
    const [shilin, beitou] = await Promise.all([
      getDistrictWeather("台北市", "士林區"),
      getDistrictWeather("台北市", "北投區"),
    ]);
    expect(shilin.rainfall12h.map((b) => b.pop)).toEqual([10, 20, 80]);

    const lookup = new Map([
      [districtKey("台北市", "士林區"), toDistrictWeather(shilin)],
      [districtKey("台北市", "北投區"), toDistrictWeather(beitou)],
    ]);
    // 08:00 出發：士林區 60–70 km → 11:00–11:30（09–12 時段 20%）；北投區 80–90 km → 12:00–12:30（12–15 時段 80%）
    const route = makeRoute({
      distance: 90,
      elevationProfile: flatProfile(90),
      segments: [segment("士林區", [60, 70]), segment("北投區", [80, 90])],
    });
    const now = new Date("2026-10-01T08:00:00+08:00");

    const enriched = applyWeather(route, lookup, { departureTime: now });
    expect(enriched.segments.map((s) => s.rainProbability)).toEqual([20, 80]);

    const b = briefRoute(route, lookup, { now });
    expect(b.verdict.level).toBe("risky");
    expect(b.maxRain).toBe(80);
    // 時段標籤為 24 小時制
    expect(b.periodLabel).toBe("09:00–15:00");
  });
});

test.describe("缺口 4：雨量只取路線 3 km 內測站", () => {
  let restore: () => void;
  test.beforeEach(() => {
    restore = stubCwbFetch();
  });
  test.afterEach(() => restore());

  test("路線旁測站 0.5 mm/hr、約 11 km 外測站 12 mm/hr：只採路線旁的", async () => {
    const near = [
      { lat: 25.09, lon: 121.55 },
      { lat: 25.11, lon: 121.55 },
    ];
    const w = await getDistrictWeather("台北市", "士林區", { near });
    expect(w.rainfallMmPerHr).toBe(0.5);
    expect(w.rainfallScope).toBe("nearby");
  });

  test("路線 3 km 內沒有測站時，縣市最大值不拿來判斷", async () => {
    const w = await getDistrictWeather("台北市", "士林區", { near: [{ lat: 25.3, lon: 121.9 }] });
    expect(w.rainfallScope).toBe("county");
    expect(w.verdict).not.toContain("大雨");
    expect(w.verdictType).not.toBe("bad");
  });
});

test.describe("Dashboard 判讀納入路線 3 km 內即時雨量", () => {
  const route = makeRoute({ segments: [segment("士林區", [0, 5, 10, 15, 20])] });
  const brief = (observedRainMmPerHr?: number | null) =>
    briefRoute(route, new Map([[districtKey("台北市", "士林區"), weather(10, { observedRainMmPerHr })]]));

  test("即時雨量 ≥ 2.6 mm/hr 判為危險，0.5–2.5 判為注意，未達 0.5 不示警", () => {
    const heavy = brief(3);
    expect(heavy.verdict.level).toBe("risky");
    expect(heavy.verdict.headline).toContain("即時雨量 3 mm/hr");
    expect(brief(1).verdict.level).toBe("caution");
    expect(brief(0.2).verdict.level).toBe("clear");
  });

  test("附近沒有雨量站時不改判 unknown，也不加註", () => {
    const b = brief(null);
    expect(b.verdict.level).toBe("clear");
    expect(b.verdict.note).toBe("");
  });

  test("沒有查詢即時雨量（undefined）時不加註，維持原判定", () => {
    const b = brief(undefined);
    expect(b.verdict.level).toBe("clear");
    expect(b.verdict.note).toBe("");
  });

  test("routeDistrictPoints 依 sampleKms 取路線上的座標，各行政區分開", () => {
    const r = makeRoute({ segments: [segment("士林區", [0, 5]), segment("北投區", [15, 20])] });
    const points = routeDistrictPoints([r]);
    expect(points.get(districtKey("台北市", "士林區"))).toHaveLength(2);
    const beitou = points.get(districtKey("台北市", "北投區"))!;
    // makeRoute 為往北直線：lat = 25.05 + km / 111（polyline 編碼會四捨五入座標）
    expect(beitou[0]!.lat).toBeCloseTo(25.05 + 15 / 111, 3);
    expect(beitou[1]!.lat).toBeCloseTo(25.05 + 20 / 111, 3);
  });

  test("串接 CWB 雨量站：每條路線只看自己旁邊的測站，同區另一條路線不受影響", async () => {
    const restore = stubCwbFetch();
    try {
      // 雨量站：0.5 mm/hr 在 (25.1, 121.56)；12 mm/hr 在 (24.99, 121.57)
      // A 線經過 0.5 mm/hr 測站旁（約 1 km）；B 線同在士林區但往東 10 km 外，3 km 內沒有測站
      const segs = [segment("士林區", [4.5, 5.5, 6.5])];
      const a = makeRoute({ id: "a", segments: segs });
      const b = makeRoute({
        id: "b",
        segments: segs,
        gpxPreviewPath: encodePolyline(flatProfile().map(([km]) => ({ lat: 25.05 + km / 111, lon: 121.66 }))),
      });

      const w = await getDistrictWeather("台北市", "士林區");
      const lookup = new Map([[districtKey("台北市", "士林區"), toDistrictWeather(w)]]);
      const stations = new Map([["台北市", await getCountyRainfallStations("台北市")]]);
      const now = new Date("2026-10-01T07:00:00+08:00");

      const briefA = briefRoute(a, withRouteObservedRain(a, lookup, stations), { now });
      expect(briefA.verdict.level).toBe("caution");
      expect(briefA.verdict.headline).toContain("即時雨量 0.5 mm/hr");

      const briefB = briefRoute(b, withRouteObservedRain(b, lookup, stations), { now });
      expect(briefB.verdict.level).toBe("clear");
      expect(briefB.verdict.note).toBe("");
    } finally {
      restore();
    }
  });

  test("縣市雨量站取不到時視為附近無測站，維持預報判定、不加註", () => {
    const route = makeRoute({ segments: [segment("士林區", [0, 10, 20])] });
    const lookup = new Map([[districtKey("台北市", "士林區"), weather(10)]]);
    const b = briefRoute(route, withRouteObservedRain(route, lookup, new Map([["台北市", null]])));
    expect(b.verdict.level).toBe("clear");
    expect(b.verdict.note).toBe("");
  });
});
