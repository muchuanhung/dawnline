/**
 * T10 降雨信心：降雨機率高但預估雨量小時，「危險」降成「注意」並加註；
 * 缺預估雨量、預估雨量大、有雷雨字樣時維持降雨機率的判定。
 */
import { test, expect } from "@playwright/test";
import {
  NOWCAST_LIGHT_MAX_MM,
  computeHazards,
  deriveStages,
  forecastRainLevel,
  summarizeVerdict,
} from "@/lib/routes/recon-geo";
import { QPF_GRID, TWD67_SHIFT, nowcastMmNear } from "@/lib/cwb/radar";
import { briefRoute, districtKey, withRouteNowcast, type DistrictWeather } from "@/lib/dashboard/briefing";
import {
  pickWeatherTextsForSegment,
  weatherTextBucketsFromCwb,
  windBucketsFromCwb,
  type RainfallBucket,
} from "@/lib/cwb/forecast-eta";
import { makeRoute, segment, withWeather } from "../fixtures/route";

const verdictOf = (rain: number, extra: Parameters<typeof withWeather>[1] = {}) => {
  const route = makeRoute({ segments: [segment("士林區", [0, 10, 20], withWeather(rain, extra))] });
  const stages = deriveStages(route);
  const hazards = computeHazards(route, stages);
  return { hazards, verdict: summarizeVerdict(hazards, stages) };
};

test.describe("forecastRainLevel：三種情境", () => {
  test("機率高、預估雨量小：危險降成注意，標籤加註雨量", () => {
    const { hazards, verdict } = verdictOf(80, { nowcastRainMm: 0.4, weatherText: "短暫陣雨" });
    expect(hazards).toHaveLength(1);
    expect(hazards[0]).toMatchObject({ kind: "rain", level: "caution" });
    expect(hazards[0]!.label).toBe("降雨 80%・雨勢小");
    expect(verdict.level).toBe("caution");
    expect(verdict.headline).toBe("0.0 km 起降雨 80%・雨勢小");
  });

  test("機率高、預估雨量大：維持危險", () => {
    const { hazards, verdict } = verdictOf(80, { nowcastRainMm: NOWCAST_LIGHT_MAX_MM });
    expect(hazards[0]).toMatchObject({ level: "risky", label: "降雨 80%" });
    expect(verdict.level).toBe("risky");
  });

  test("缺預估雨量：維持現行規則（危險）", () => {
    const { hazards, verdict } = verdictOf(80);
    expect(hazards[0]).toMatchObject({ level: "risky", label: "降雨 80%" });
    expect(verdict.level).toBe("risky");
  });

  test("預估雨量 0 mm 也只降到注意，不會判成安全", () => {
    const { verdict } = verdictOf(90, { nowcastRainMm: 0 });
    expect(verdict.level).toBe("caution");
  });

  test("機率在注意區間（40–59%）：不受預估雨量影響", () => {
    expect(forecastRainLevel({ rainProbability: 45, nowcastRainMm: 0 })).toEqual({ level: "caution", downgraded: false });
    expect(forecastRainLevel({ rainProbability: 20, nowcastRainMm: 0 })).toEqual({ level: null, downgraded: false });
  });

  test("天氣現象有雷、大雨、豪雨或 condition 為 stormy 時不降級", () => {
    for (const weatherText of ["午後短暫雷陣雨", "陰有大雨", "豪雨"]) {
      expect(forecastRainLevel({ rainProbability: 80, nowcastRainMm: 0.2, weatherText }).level).toBe("risky");
    }
    expect(forecastRainLevel({ rainProbability: 80, nowcastRainMm: 0.2, condition: "stormy" }).level).toBe("risky");
  });

  test("即時雨量站已量到中雨時不降級", () => {
    expect(forecastRainLevel({ rainProbability: 80, nowcastRainMm: 0.2, observedRainMmPerHr: 3 }).level).toBe("risky");
    expect(forecastRainLevel({ rainProbability: 80, nowcastRainMm: 0.2, observedRainMmPerHr: 0.5 }).level).toBe("caution");
  });

  test("相鄰的降級與未降級路段不合併標籤", () => {
    const route = makeRoute({
      segments: [
        segment("士林區", [0, 5], withWeather(80, { nowcastRainMm: 0.3 })),
        segment("北投區", [15, 20], withWeather(45)),
      ],
    });
    const labels = computeHazards(route, deriveStages(route)).map((h) => h.label);
    expect(labels).toEqual(["降雨 80%・雨勢小", "降雨 45%"]);
  });
});

/** 全格點為 fill，指定的 WGS84 座標（含周圍 radius 格）設為 mm */
function grid(fill: number, spots: { lat: number; lon: number; mm: number }[] = []): Float32Array {
  const { lon0, lat0, res, nx, ny } = QPF_GRID;
  const values = new Float32Array(nx * ny).fill(fill);
  for (const { lat, lon, mm } of spots) {
    const col = Math.round((lon - TWD67_SHIFT.lon - lon0) / res);
    const row = Math.round((lat - TWD67_SHIFT.lat - lat0) / res);
    values[row * nx + col] = mm;
  }
  return values;
}

test.describe("nowcastMmNear：沿線取樣", () => {
  const p = { lat: 25.1, lon: 121.55 };

  test("取路線點周圍的最大值；-99（沒有雨）當 0", () => {
    expect(nowcastMmNear(grid(-99), [p])).toBe(0);
    expect(nowcastMmNear(grid(-99, [{ ...p, mm: 1.24 }]), [p])).toBe(1.2);
  });

  test("約 2.8 km 內的雨也算進去，更遠的不算", () => {
    const near = { lat: p.lat + 0.025, lon: p.lon, mm: 5 };
    const far = { lat: p.lat + 0.05, lon: p.lon, mm: 5 };
    expect(nowcastMmNear(grid(-99, [near]), [p])).toBe(5);
    expect(nowcastMmNear(grid(-99, [far]), [p])).toBe(0);
  });

  test("點在格點外、格點大小不對、數值無法解析、沒有點：回 null（不降級）", () => {
    expect(nowcastMmNear(grid(0), [{ lat: 10, lon: 121 }])).toBeNull();
    expect(nowcastMmNear(new Float32Array(10), [p])).toBeNull();
    expect(nowcastMmNear(grid(Number.NaN), [p])).toBeNull();
    expect(nowcastMmNear(grid(0), [])).toBeNull();
  });
});

test.describe("天氣現象時段", () => {
  const times = [
    { StartTime: "2026-10-01T06:00:00+08:00", EndTime: "2026-10-01T09:00:00+08:00", ElementValue: [{ Weather: "多雲" }] },
    { StartTime: "2026-10-01T09:00:00+08:00", EndTime: "2026-10-01T12:00:00+08:00", ElementValue: [{ Weather: "短暫陣雨" }] },
    { StartTime: "2026-10-01T12:00:00+08:00", EndTime: "2026-10-01T15:00:00+08:00", ElementValue: [{ Weather: "" }] },
  ];

  test("空字串略過；路段跨時段時全部列出", () => {
    const buckets = weatherTextBucketsFromCwb(times);
    expect(buckets.map((b) => b.text)).toEqual(["多雲", "短暫陣雨"]);
    // 08:00 出發、20 km/h：0–40 km 為 08:00–10:00，跨兩個時段
    expect(pickWeatherTextsForSegment([0, 40], new Date("2026-10-01T08:00:00+08:00"), buckets)).toEqual([
      "多雲",
      "短暫陣雨",
    ]);
  });

  test("風速時段改用共用解析後結果不變", () => {
    const wind = [{ DataTime: "2026-10-01T06:00:00+08:00", ElementValue: [{ WindSpeed: "10" }] }];
    expect(windBucketsFromCwb(wind)).toEqual([
      { startTime: "2026-10-01T06:00:00+08:00", endTime: "2026-10-01T01:00:00.000Z", kmh: 36 },
    ]);
  });
});

test.describe("briefRoute：預估雨量只用在 1 小時內會走完的路段", () => {
  const AT_8AM = new Date("2026-10-01T08:00:00+08:00");
  const allDayRain: RainfallBucket[] = [
    { startTime: "2026-10-01T06:00:00+08:00", endTime: "2026-10-01T18:00:00+08:00", pop: 80, label: "06:00", endLabel: "18:00" },
  ];
  const weather: DistrictWeather = {
    rainProbability: 80,
    windSpeedKmh: 5,
    temperature: 25,
    condition: "rainy",
    periodLabel: null,
    rainfallBuckets: allDayRain,
  };
  const lookup = new Map([
    [districtKey("台北市", "士林區"), weather],
    [districtKey("台北市", "北投區"), weather],
  ]);
  // 區段交界取中點：士林區 0–20 km（08:00–09:00）、北投區 20–40 km（09:00–10:00），20 km/h
  const route = makeRoute({
    distance: 40,
    elevationProfile: Array.from({ length: 401 }, (_, i) => [i / 10, 100] as [number, number]),
    segments: [segment("士林區", [0, 10]), segment("北投區", [30, 40])],
  });
  // 08:00 起報、涵蓋到 09:00：士林區剛好走完，北投區不在涵蓋內
  const nowcast = { issuedAt: "2026-10-01T08:00:00+08:00", values: grid(-99) };

  test("1 小時內走完的路段降成注意，之後的路段仍危險", () => {
    const b = briefRoute(route, withRouteNowcast(route, lookup, nowcast, AT_8AM), { now: AT_8AM });
    expect(b.hazards.map((h) => [h.level, h.label])).toEqual([
      ["caution", "降雨 80%・雨勢小"],
      ["risky", "降雨 80%"],
    ]);
    expect(b.verdict.level).toBe("risky");
  });

  test("預報起點超過 30 分鐘（過期）：不採用，維持危險", () => {
    const stale = { ...nowcast, issuedAt: "2026-10-01T07:25:00+08:00" };
    const b = briefRoute(route, withRouteNowcast(route, lookup, stale, AT_8AM), { now: AT_8AM });
    expect(b.hazards.every((h) => h.level === "risky")).toBe(true);
  });

  test("取不到預估雨量（null）：與現行規則相同", () => {
    const withNull = briefRoute(route, withRouteNowcast(route, lookup, null, AT_8AM), { now: AT_8AM });
    const without = briefRoute(route, lookup, { now: AT_8AM });
    expect(withNull.hazards).toEqual(without.hazards);
    expect(withNull.verdict).toEqual(without.verdict);
  });

  test("晚出發（預估雨量涵蓋不到）：不採用", () => {
    const b = briefRoute(route, withRouteNowcast(route, lookup, nowcast, AT_8AM), {
      now: AT_8AM,
      departure: new Date("2026-10-01T09:00:00+08:00"),
    });
    expect(b.hazards.every((h) => h.level === "risky")).toBe(true);
  });
});
