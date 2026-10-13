import { test, expect } from "@playwright/test";
import type { CctvMarker, Hazard } from "@/lib/routes/recon-geo";
import {
  groupTrackFlags,
  markerOrdinal,
  snapToMarker,
  stepMarker,
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

test.describe("stepMarker／markerOrdinal 逐台切換", () => {
  const markers = [marker("c", 6.5), marker("a", 0), marker("b", 0), marker("d", 9.9)];

  test("依里程排序，同一點的多台鏡頭也能逐台切換", () => {
    const first = stepMarker(markers, null, 1)!;
    expect(first.km).toBe(0);
    const second = stepMarker(markers, first, 1)!;
    expect(second.km).toBe(0);
    expect(second.id).not.toBe(first.id);
    expect(stepMarker(markers, second, 1)!.id).toBe("c");
  });

  test("已在頭尾時回傳 null", () => {
    expect(stepMarker(markers, markers[3]!, 1)).toBeNull();
    expect(stepMarker(markers, stepMarker(markers, null, 1), -1)).toBeNull();
  });

  test("沒有鏡頭時回傳 null", () => {
    expect(stepMarker([], null, 1)).toBeNull();
    expect(markerOrdinal([], null)).toBeNull();
  });

  test("序號依里程排序、1 起算", () => {
    expect(markerOrdinal(markers, markers[0]!)).toBe(3);
    expect(markerOrdinal(markers, markers[3]!)).toBe(4);
  });
});

test.describe("snapToMarker 放開拖曳時的落點", () => {
  const markers = [marker("a", 2), marker("b", 6.5)];

  test("吸附距離內停在最近的鏡頭", () => {
    // 10 km 路線吸附距離 0.5 km
    expect(snapToMarker(markers, 6.2, 10)).toBe(6.5);
  });

  test("附近沒有鏡頭就停在原地", () => {
    expect(snapToMarker(markers, 4.2, 10)).toBe(4.2);
  });

  test("長路線吸附距離最多 1 km", () => {
    expect(snapToMarker(markers, 3.2, 100)).toBe(3.2);
    expect(snapToMarker(markers, 2.9, 100)).toBe(2);
  });

  test("沒有鏡頭時停在原地", () => {
    expect(snapToMarker([], 3, 10)).toBe(3);
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
