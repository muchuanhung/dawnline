import { test, expect } from "@playwright/test";
import type { CctvMarker, Hazard } from "@/lib/routes/recon-geo";
import {
  groupTrackFlags,
  markerOrdinal,
  nearestStop,
  stepStop,
  stopKey,
  trackStops,
  trackTicks,
} from "@/lib/routes/route-track";

const kms = (totalKm: number) => trackTicks(totalKm).map((t) => t.km);

function marker(id: string, km: number): CctvMarker {
  return { id, km, name: id };
}

function hazard(id: string, startKm: number, level: Hazard["level"] = "caution"): Hazard {
  return { id, kind: "event", level, startKm, endKm: startKm, label: id };
}

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
  const flags = groupTrackFlags([hazard("h", 24, "risky")], 50);
  const stops = trackStops(markers, flags);
  const key = (s: ReturnType<typeof nearestStop>) => (s ? stopKey(s) : null);

  test("停點依里程排序，示警也是停點", () => {
    expect(stops.map((s) => s.km)).toEqual([2, 6, 15.9, 24, 33.7]);
    expect(stops[3]!.kind).toBe("flag");
  });

  test("同一里程時示警排在鏡頭前", () => {
    const same = trackStops([marker("m", 5)], groupTrackFlags([hazard("h", 5)], 10));
    expect(same.map((s) => s.kind)).toEqual(["flag", "marker"]);
  });

  test("拖到兩個停點中間，跳到最近的停點，不停在中間的公里數", () => {
    expect(key(nearestStop(stops, 19))).toBe("m:m3");
    expect(key(nearestStop(stops, 21))).toBe("f:24");
    expect(key(nearestStop(stops, 30))).toBe("m:m4");
    expect(key(nearestStop(stops, 50))).toBe("m:m4");
  });

  test("沒有停點時為 null，軌道改回連續拖曳", () => {
    expect(nearestStop([], 3)).toBeNull();
  });

  test("‹ › 從目前停點照順序走，中間的示警算一站", () => {
    const m3 = stops[2]!;
    const next = stepStop(stops, m3, m3.km, 1)!;
    expect(stopKey(next)).toBe("f:24");
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

test.describe("groupTrackFlags 示警旗標", () => {
  test("彼此太近的示警合併成一支，等級取最嚴重", () => {
    // 10 km 路線，0.6 km 內合併
    const flags = groupTrackFlags([hazard("x", 2.3, "risky"), hazard("y", 2.0), hazard("z", 6.8)], 10);
    expect(flags).toHaveLength(2);
    expect(flags[0]).toMatchObject({ km: 2.0, level: "risky" });
    expect(flags[0]!.hazards.map((h) => h.id)).toEqual(["y", "x"]);
    expect(flags[1]).toMatchObject({ km: 6.8, level: "caution" });
  });

  test("沒有示警時沒有旗標", () => {
    expect(groupTrackFlags([], 10)).toEqual([]);
  });
});
