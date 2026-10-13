import { test, expect } from "@playwright/test";
import type { CctvMarker, Hazard, RouteStage } from "@/lib/routes/recon-geo";
import {
  hazardZones,
  markerOrdinal,
  nearestStop,
  stepStop,
  stopKey,
  trackStops,
  trackTicks,
  trackZones,
  zoneAt,
  zonesForPaint,
} from "@/lib/routes/route-track";

const kms = (totalKm: number) => trackTicks(totalKm).map((t) => t.km);

function marker(id: string, km: number): CctvMarker {
  return { id, km, name: id };
}

function hazard(id: string, startKm: number, level: Hazard["level"] = "caution", endKm = startKm): Hazard {
  return { id, kind: "event", level, startKm, endKm, label: id };
}

function stage(startKm: number, endKm: number, weather: Partial<RouteStage> = {}): RouteStage {
  return {
    id: `s${startKm}`,
    km: startKm,
    startKm,
    endKm,
    name: "區",
    rainProbability: 0,
    temperature: 20,
    windSpeed: 0,
    hasWeather: true,
    weatherStale: false,
    outOfCoverage: false,
    ...weather,
  };
}

const levels = (zones: { startKm: number; endKm: number; level: string }[]) =>
  zones.map((z) => [z.startKm, z.endKm, z.level]);

test.describe("trackTicks 依路線長度給整數刻度", () => {
  test("頭尾一定標，中間取整齊間距，終點四捨五入", () => {
    expect(kms(3.2)).toEqual([0, 2, 3]);
    expect(kms(10.6)).toEqual([0, 5, 11]);
    expect(kms(42)).toEqual([0, 20, 42]);
  });

  test("中間刻度離終點太近就不標", () => {
    // 100 km 在 120 km 路線的 83% 處，離終點不到 20%
    expect(kms(120)).toEqual([0, 50, 120]);
  });

  test("中間刻度與四捨五入後的終點相同時不重複標", () => {
    expect(kms(1.4)).toEqual([0, 1]);
  });

  test("終點刻度永遠在最右端，中間刻度依實際里程定位", () => {
    const ticks = trackTicks(10.6);
    expect(ticks[ticks.length - 1]!.at).toBe(1);
    expect(ticks[1]!.at).toBeCloseTo(5 / 10.6);
  });

  test("長度為 0、不到半公里或不是數字時只標 0", () => {
    expect(kms(0)).toEqual([0]);
    expect(kms(0.4)).toEqual([0]);
    expect(kms(Number.NaN)).toEqual([0]);
  });
});

test.describe("markerOrdinal 鏡頭序號", () => {
  const markers = [marker("c", 6.5), marker("a", 0), marker("b", 0), marker("d", 9.9)];

  test("序號依里程排序、1 起算", () => {
    expect(markerOrdinal(markers, markers[0]!)).toBe(3);
    expect(markerOrdinal(markers, markers[3]!)).toBe(4);
  });

  test("沒有鏡頭時為 null", () => {
    expect(markerOrdinal([], null)).toBeNull();
  });
});

test.describe("軌道停點：只停在鏡頭與示警", () => {
  // 第 3 台 15.9 km、第 4 台 33.7 km，中間 24 km 有示警
  const markers = [marker("m4", 33.7), marker("m1", 2), marker("m3", 15.9), marker("m2", 6)];
  const zones = hazardZones([hazard("h", 24, "risky")], 50);
  const stops = trackStops(markers, zones);
  const key = (s: ReturnType<typeof nearestStop>) => (s ? stopKey(s) : null);

  test("停點依里程排序，示警路段也是停點", () => {
    expect(stops.map((s) => s.km)).toEqual([2, 6, 15.9, 24, 33.7]);
    expect(stops[3]!.kind).toBe("zone");
  });

  test("同一里程時示警排在鏡頭前", () => {
    const same = trackStops([marker("m", 5)], hazardZones([hazard("h", 5)], 10));
    expect(same.map((s) => s.kind)).toEqual(["zone", "marker"]);
  });

  test("一般路段（安全、未判定）不是停點", () => {
    const zones = trackZones(10, [], [stage(0, 10)], { eventsComplete: true });
    expect(trackStops([], zones)).toEqual([]);
  });

  test("拖到兩個停點中間，跳到最近的停點，不停在中間的公里數", () => {
    expect(key(nearestStop(stops, 19))).toBe("m:m3");
    expect(key(nearestStop(stops, 21))).toBe("z:24");
    expect(key(nearestStop(stops, 30))).toBe("m:m4");
    expect(key(nearestStop(stops, 50))).toBe("m:m4");
  });

  test("沒有停點時為 null，軌道改回連續拖曳", () => {
    expect(nearestStop([], 3)).toBeNull();
  });

  test("‹ › 從目前停點照順序走，中間的示警算一站", () => {
    const m3 = stops[2]!;
    const next = stepStop(stops, m3, m3.km, 1)!;
    expect(stopKey(next)).toBe("z:24");
    expect(stopKey(stepStop(stops, next, next.km, 1)!)).toBe("m:m4");
    expect(stopKey(stepStop(stops, m3, m3.km, -1)!)).toBe("m:m2");
  });

  test("不在停點上時，找目前里程之後或之前的第一個", () => {
    expect(stopKey(stepStop(stops, null, 10, 1)!)).toBe("m:m3");
    expect(stopKey(stepStop(stops, null, 10, -1)!)).toBe("m:m2");
    expect(stopKey(stepStop(stops, null, 0, 1)!)).toBe("m:m1");
  });

  test("已在頭尾時為 null", () => {
    expect(stepStop(stops, stops[4]!, 33.7, 1)).toBeNull();
    expect(stepStop(stops, stops[0]!, 2, -1)).toBeNull();
    expect(stepStop(stops, null, 40, 1)).toBeNull();
    expect(stepStop([], null, 3, 1)).toBeNull();
  });
});

test.describe("hazardZones 示警路段", () => {
  test("同等級且彼此太近的示警併成一段", () => {
    // 10 km 路線，空隙小於 0.6 km 就合併
    const zones = hazardZones([hazard("x", 2.3), hazard("y", 2.0), hazard("z", 6.8)], 10);
    expect(zones).toHaveLength(2);
    expect(zones[0]).toMatchObject({ startKm: 2.0, level: "caution" });
    expect(zones[0]!.hazards.map((h) => h.id)).toEqual(["y", "x"]);
    expect(zones[1]).toMatchObject({ startKm: 6.8, level: "caution" });
  });

  test("不同等級不合併，注意不會被旁邊的危險吃掉", () => {
    const zones = hazardZones([hazard("acc", 2.6), hazard("rain", 5, "risky", 20)], 20);
    expect(zones.map((z) => [z.startKm, z.level])).toEqual([
      [2.6, "caution"],
      [5, "risky"],
    ]);
  });

  test("很多示警擠在一起時只剩一段", () => {
    const dense = [2.0, 2.2, 2.5, 2.7, 3.0, 3.3].map((km, i) => hazard(`h${i}`, km));
    const zones = hazardZones(dense, 10);
    expect(zones).toHaveLength(1);
    expect(zones[0]!.hazards).toHaveLength(6);
  });

  test("單點示警至少佔全長 2%，看得到", () => {
    const [z] = hazardZones([hazard("p", 5)], 50);
    expect(z!.endKm).toBeCloseTo(6);
  });

  test("有長度的示警照實際範圍，不超出終點", () => {
    const [z] = hazardZones([hazard("r", 8, "caution", 12)], 10);
    expect([z!.startKm, z!.endKm]).toEqual([8, 10]);
  });

  test("沒有示警時沒有示警路段", () => {
    expect(hazardZones([], 10)).toEqual([]);
  });
});

test.describe("trackZones 軌道路況色段", () => {
  test("有天氣、路況完整的路段才算安全，示警路段蓋在上面", () => {
    const zones = trackZones(10, [hazard("r", 4, "risky", 6)], [stage(0, 5), stage(5, 10)], { eventsComplete: true });
    expect(levels(zones)).toEqual([
      [0, 4, "clear"],
      [4, 6, "risky"],
      [6, 10, "clear"],
    ]);
  });

  test("缺天氣、預報過期、超出預報時段的路段一律未判定，不算安全", () => {
    const zones = trackZones(
      12,
      [],
      [stage(0, 3, { hasWeather: false }), stage(3, 6, { weatherStale: true }), stage(6, 9, { outOfCoverage: true }), stage(9, 12)],
      { eventsComplete: true }
    );
    expect(levels(zones)).toEqual([
      [0, 9, "unknown"],
      [9, 12, "clear"],
    ]);
  });

  test("路況事件取不到時，沒有示警的路段也是未判定", () => {
    const zones = trackZones(10, [hazard("r", 4, "risky", 6)], [stage(0, 10)], { eventsComplete: false });
    expect(levels(zones)).toEqual([
      [0, 4, "unknown"],
      [4, 6, "risky"],
      [6, 10, "unknown"],
    ]);
  });

  test("判讀還沒回來（沒有 stage）時只畫示警，不上安全色", () => {
    expect(trackZones(10, [], [], { eventsComplete: true })).toEqual([]);
  });

  test("途中模式：已走過的路段不上色", () => {
    const zones = trackZones(10, [], [stage(0, 10)], { eventsComplete: true, fromKm: 4 });
    expect(levels(zones)).toEqual([[4, 10, "clear"]]);
  });

  test("危險與注意重疊時，所在色段取危險，畫的時候危險在上層", () => {
    const zones = trackZones(20, [hazard("rain", 5, "risky", 20), hazard("acc", 10)], [stage(0, 20)], {
      eventsComplete: true,
    });
    expect(zoneAt(zones, 10.1)?.level).toBe("risky");
    expect(zonesForPaint(zones).map((z) => z.level)).toEqual(["clear", "caution", "risky"]);
  });

  test("zoneAt 取所在色段，示警路段優先", () => {
    const zones = trackZones(10, [hazard("r", 4, "risky", 6)], [stage(0, 10)], { eventsComplete: true });
    expect(zoneAt(zones, 5)?.level).toBe("risky");
    expect(zoneAt(zones, 4)?.level).toBe("risky");
    expect(zoneAt(zones, 8)?.level).toBe("clear");
    expect(zoneAt([], 8)).toBeNull();
  });
});
