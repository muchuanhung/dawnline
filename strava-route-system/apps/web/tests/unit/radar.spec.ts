import { test, expect } from "@playwright/test";
import {
  DBZ_COLORS,
  RADAR_ASPECT,
  RADAR_IMAGE,
  TWD67_SHIFT,
  bboxOfPoints,
  fitViewBox,
  RADAR_VIEW,
  dbzFromColor,
  dbzFromRainRate,
  isRadarStale,
  legendTicks,
  pointAtKm,
  projectToExtent,
  radarCropFor,
  rainRateFromDbz,
  rainRateLabel,
  type Extent,
} from "@/lib/cwb/radar";

// 冷水坑＋陽金公路＋小油坑的 bbox
const YANGMINGSHAN: Extent = [121.529, 25.101, 121.637, 25.222];
const NOW = Date.parse("2026-10-22T22:50:00+08:00");

test.describe("radarCropFor", () => {
  test("裁切範圍包住路線並外擴", () => {
    const crop = radarCropFor(YANGMINGSHAN)!;
    const [minLon, minLat, maxLon, maxLat] = crop.extent;
    expect(minLon).toBeLessThan(YANGMINGSHAN[0]);
    expect(minLat).toBeLessThan(YANGMINGSHAN[1]);
    expect(maxLon).toBeGreaterThan(YANGMINGSHAN[2]);
    expect(maxLat).toBeGreaterThan(YANGMINGSHAN[3]);
  });

  test("以公里計為 RADAR_ASPECT 的寬圖", () => {
    const { extent } = radarCropFor(YANGMINGSHAN)!;
    const cos = Math.cos((((extent[1] + extent[3]) / 2) * Math.PI) / 180);
    const ratio = ((extent[2] - extent[0]) * cos) / (extent[3] - extent[1]);
    expect(ratio).toBeCloseTo(RADAR_ASPECT, 1);
  });

  test("很短的路線也至少涵蓋約 22 km 南北", () => {
    const { extent } = radarCropFor([121.55, 25.1, 121.551, 25.101])!;
    expect(extent[3] - extent[1]).toBeGreaterThanOrEqual(0.2);
  });

  test("像素範圍是整數，且反推的範圍與像素一一對應（含 TWD67 平移）", () => {
    const { extent, pixel } = radarCropFor(YANGMINGSHAN)!;
    for (const v of Object.values(pixel)) expect(Number.isInteger(v)).toBe(true);
    const degPerPx = (RADAR_IMAGE.maxLon - RADAR_IMAGE.minLon) / RADAR_IMAGE.size;
    expect(extent[0] - TWD67_SHIFT.lon).toBeCloseTo(RADAR_IMAGE.minLon + pixel.left * degPerPx, 9);
    expect(extent[3] - TWD67_SHIFT.lat).toBeCloseTo(RADAR_IMAGE.maxLat - pixel.top * degPerPx, 9);
    expect((extent[2] - extent[0]) / degPerPx).toBeCloseTo(pixel.width, 6);
  });

  test("超出圖層範圍或座標不合法時回 null", () => {
    expect(radarCropFor([139.7, 35.6, 139.8, 35.7])).toBeNull();
    expect(radarCropFor([118.0, 24.4, 118.05, 24.45])).toBeNull();
    expect(radarCropFor([NaN, 25, 121, 25.1])).toBeNull();
    expect(radarCropFor([121.6, 25.2, 121.5, 25.1])).toBeNull();
  });
});

test.describe("projectToExtent / pointAtKm", () => {
  test("範圍四角投影到 0–1", () => {
    const e: Extent = [121, 25, 122, 26];
    expect(projectToExtent(e, 26, 121)).toEqual([0, 0]);
    expect(projectToExtent(e, 25, 122)).toEqual([1, 1]);
    expect(projectToExtent(e, 25.5, 121.5)).toEqual([0.5, 0.5]);
  });

  test("bboxOfPoints：[lat, lon] 轉成 [minLon, minLat, maxLon, maxLat]", () => {
    expect(bboxOfPoints([[25.2, 121.6], [25.1, 121.5]])).toEqual([121.5, 25.1, 121.6, 25.2]);
    expect(bboxOfPoints([])).toBeNull();
  });

  test("里程內插與端點", () => {
    const pts: [number, number][] = [[25, 121], [25.1, 121], [25.1, 121.2]];
    const km = [0, 10, 30];
    expect(pointAtKm(pts, km, 5)).toEqual([25.05, 121]);
    expect(pointAtKm(pts, km, 20)![1]).toBeCloseTo(121.1, 9);
    expect(pointAtKm(pts, km, -1)).toEqual([25, 121]);
    expect(pointAtKm(pts, km, 99)).toEqual([25.1, 121.2]);
    expect(pointAtKm(pts, [0, 1], 0)).toBeNull();
  });
});

test.describe("fitViewBox", () => {
  const route = { minX: 220, minY: 70, maxX: 260, maxY: 130 };
  const inside = ([x, y, w, h]: number[]) => {
    expect(x).toBeGreaterThanOrEqual(0);
    expect(y).toBeGreaterThanOrEqual(0);
    expect(x! + w!).toBeLessThanOrEqual(RADAR_VIEW.width + 1e-9);
    expect(y! + h!).toBeLessThanOrEqual(RADAR_VIEW.height + 1e-9);
  };

  test("維持容器比例並留在圖內", () => {
    for (const aspect of [4 / 3, 1.37, 2.34]) {
      const box = fitViewBox(route, aspect, { top: 0.35, bottom: 0.25 });
      expect(box[2] / box[3]).toBeCloseTo(aspect, 6);
      inside(box);
    }
  });

  test("路線落在上下沒被蓋住的那一段", () => {
    const [, y, , h] = fitViewBox(route, 4 / 3, { top: 0.35, bottom: 0.25 });
    expect((route.minY - y) / h).toBeGreaterThanOrEqual(0.35 - 1e-9);
    expect((route.maxY - y) / h).toBeLessThanOrEqual(0.75 + 1e-9);
  });

  test("路線寬度完整入鏡", () => {
    const [x, , w] = fitViewBox(route, 1.37, { top: 0, bottom: 0.2 });
    expect(x).toBeLessThanOrEqual(route.minX);
    expect(x + w).toBeGreaterThanOrEqual(route.maxX);
  });

  test("路線比圖還大時取整張圖的範圍內", () => {
    inside(fitViewBox({ minX: 0, minY: 0, maxX: 480, maxY: 200 }, 4 / 3, { top: 0.35, bottom: 0.25 }));
  });
});

test.describe("dbzFromColor", () => {
  test("色階上的每個顏色都反查回原本的 dBZ", () => {
    DBZ_COLORS.forEach(([r, g, b], dbz) => expect(dbzFromColor(r, g, b, 255)).toEqual({ echo: true, dbz }));
  });

  test("透明＝沒有回波", () => {
    expect(dbzFromColor(0, 0, 0, 0)).toEqual({ echo: false, dbz: null });
  });

  test("不透明但不在色階內：有回波但不猜數值", () => {
    expect(dbzFromColor(160, 0, 255, 255)).toEqual({ echo: true, dbz: null });
  });
});

test.describe("降雨強度換算", () => {
  test("Marshall–Palmer：23 dBZ 約 1 mm/h、39 dBZ 約 10 mm/h", () => {
    expect(rainRateFromDbz(23)).toBeCloseTo(1, 0);
    expect(rainRateFromDbz(39)).toBeCloseTo(10, 0);
    expect(dbzFromRainRate(rainRateFromDbz(31.5))).toBeCloseTo(31.5, 9);
  });

  test("文字：弱回波寫不到 1，其餘寫約數", () => {
    expect(rainRateLabel(10)).toBe("不到 1 mm/h");
    expect(rainRateLabel(30)).toBe("約 2.7 mm/h");
    expect(rainRateLabel(45)).toBe("約 24 mm/h");
  });

  test("圖例刻度由小到大落在色階內", () => {
    const pcts = legendTicks().map((t) => t.pct);
    expect(pcts).toEqual([...pcts].sort((a, b) => a - b));
    expect(pcts[0]).toBeGreaterThan(0);
    expect(pcts.at(-1)).toBeLessThan(100);
  });
});

test.describe("isRadarStale", () => {
  test("30 分鐘內為新鮮", () => {
    expect(isRadarStale("2026-10-22T22:40:00+08:00", NOW)).toBe(false);
  });

  test("超過 30 分鐘或時間解析不了一律過期", () => {
    expect(isRadarStale("2026-10-22T22:10:00+08:00", NOW)).toBe(true);
    expect(isRadarStale("", NOW)).toBe(true);
    expect(isRadarStale("not-a-date", NOW)).toBe(true);
  });
});
