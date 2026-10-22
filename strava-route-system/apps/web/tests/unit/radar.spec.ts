import { test, expect } from "@playwright/test";
import {
  DBZ_COLORS,
  RADAR_EXTENT,
  RADAR_FRAME_COUNT,
  RADAR_GRID,
  RADAR_IMAGE_SIZE,
  RADAR_REGION,
  RADAR_VIEW,
  STRONG_ECHO_COLOR,
  TWD67_SHIFT,
  bboxOfPoints,
  colorForDbz,
  dbzFromColor,
  dbzFromRainRate,
  fitViewBox,
  historyDatePrefixes,
  isInRadarExtent,
  isRadarFrameId,
  isRadarStale,
  latestRadarFrames,
  legendTicks,
  parseCompositeReflectivity,
  pointAtKm,
  projectToExtent,
  projectToView,
  radarViewBox,
  rainRateFromDbz,
  rainRateLabel,
  renderRadarRegion,
  viewRectOf,
  type Extent,
} from "@/lib/cwb/radar";

// 冷水坑＋陽金公路＋小油坑的 bbox
const YANGMINGSHAN: Extent = [121.529, 25.101, 121.637, 25.222];
const NOW = Date.parse("2026-10-22T22:50:00+08:00");

test.describe("雷達歷史檔清單", () => {
  const key = (id: string, kind = "compref_mosaic.xml") => `history/Observation/${id}${kind}`;

  /** 從 from 起每 10 分鐘一筆，共 n 筆（台灣時間 YYYYMMDDHHmm） */
  const every10 = (from: string, n: number) =>
    Array.from({ length: n }, (_, i) => {
      const t = new Date(Date.parse(`${from.slice(0, 4)}-${from.slice(4, 6)}-${from.slice(6, 8)}T${from.slice(8, 10)}:${from.slice(10)}:00Z`) + i * 600_000);
      return t.toISOString().slice(0, 16).replace(/\D/g, "");
    });

  test("只挑合成回波：最新一張往前每小時一張，共 7 張、舊到新", () => {
    const ids = every10("202610221600", 44); // 16:00–23:10
    const keys = [...ids.map((id) => key(id)), key("202610222310"), key("202610222320", ".QPESUMS_GAUGE.10M.xml")];
    const frames = latestRadarFrames(keys);
    expect(frames).toHaveLength(RADAR_FRAME_COUNT);
    expect(frames.map((f) => f.id)).toEqual([
      "202610221710", "202610221810", "202610221910", "202610222010", "202610222110", "202610222210", "202610222310",
    ]);
    expect(frames.at(-1)!.observedAt).toBe("2026-10-22T23:10:00+08:00");
  });

  test("整點缺圖用前後 10 分鐘內的代替，再遠就少一張，不拿更舊的補", () => {
    const frames = latestRadarFrames([key("202610221500"), key("202610222150"), key("202610222300")]);
    expect(frames.map((f) => f.id)).toEqual(["202610222150", "202610222300"]);
  });

  test("沒有任何合成回波時回空陣列", () => {
    expect(latestRadarFrames([key("202610222300", ".QPESUMS_GAUGE.10M.xml")])).toEqual([]);
  });

  test("時間戳格式", () => {
    expect(isRadarFrameId("202610222350")).toBe(true);
    expect(isRadarFrameId("2026102223")).toBe(false);
    expect(isRadarFrameId("../../etc/pas")).toBe(false);
    expect(isRadarFrameId("202613452399")).toBe(false);
  });

  test("查詢日期是台灣時間的昨天與今天", () => {
    // 台灣 10/23 00:05 = UTC 10/22 16:05
    expect(historyDatePrefixes(Date.parse("2026-10-22T16:05:00Z"))).toEqual(["20261022", "20261023"]);
  });
});

/** 921×881 的合成回波 XML；cells 指定 [列, 欄, dBZ]，其餘 -99 */
function compositeXml(
  cells: [row: number, col: number, dbz: number][],
  dims: { lon0: number; lat0: number; res: number; nx: number; ny: number } = RADAR_GRID
) {
  const values = new Array(dims.nx * dims.ny).fill("-9.900E+01");
  for (const [r, c, v] of cells) values[r * dims.nx + c] = v.toExponential(3);
  return `<cwaopendata><dataset><datasetInfo><parameterSet>
       <StartPointLongitude>${dims.lon0.toFixed(1)}</StartPointLongitude>
       <StartPointLatitude>${dims.lat0.toFixed(1)}</StartPointLatitude>
       <GridResolution>${dims.res}</GridResolution>
       <DateTime>2026-10-22T23:50:00+08:00</DateTime>
       <GridDimensionX>${dims.nx}</GridDimensionX>
       <GridDimensionY>${dims.ny}</GridDimensionY>
  </parameterSet></datasetInfo><contents><content>${values.join(",")}</content></contents></dataset></cwaopendata>`;
}

test.describe("合成回波格點", () => {
  test("解析時間與數值", () => {
    const grid = parseCompositeReflectivity(compositeXml([[0, 0, 12.5], [880, 920, -999]]));
    expect(grid.observedAt).toBe("2026-10-22T23:50:00+08:00");
    expect(grid.values[0]).toBeCloseTo(12.5, 3);
    expect(grid.values[1]).toBe(-99);
    expect(grid.values.at(-1)).toBe(-999);
  });

  test("格點規格不符就丟錯，不畫錯位的圖", () => {
    expect(() => parseCompositeReflectivity(compositeXml([], { ...RADAR_GRID, lon0: 118 }))).toThrow();
    expect(() => parseCompositeReflectivity(compositeXml([]).replace("-9.900E+01,", ""))).toThrow();
  });

  test("畫圖：左上是範圍最北、最西的格點；無回波透明", () => {
    const { col0, row1 } = RADAR_REGION;
    const { values } = parseCompositeReflectivity(compositeXml([[row1 - 1, col0, 30], [row1 - 2, col0 + 1, 60]]));
    const rgba = renderRadarRegion(values);
    expect(rgba.length).toBe(RADAR_IMAGE_SIZE.width * RADAR_IMAGE_SIZE.height * 4);
    expect([...rgba.slice(0, 4)]).toEqual([...DBZ_COLORS[30]!, 255]);
    const second = (RADAR_IMAGE_SIZE.width + 1) * 4;
    expect([...rgba.slice(second, second + 4)]).toEqual([...STRONG_ECHO_COLOR, 255]);
    expect(rgba[7]).toBe(0);
  });

  test("顏色往返：色階內反查回 dBZ，超過色階只說有回波", () => {
    for (let dbz = 0; dbz < DBZ_COLORS.length; dbz++) {
      const [r, g, b, a] = colorForDbz(dbz + 0.4);
      expect(dbzFromColor(r, g, b, a)).toEqual({ echo: true, dbz });
    }
    const [r, g, b, a] = colorForDbz(58);
    expect(dbzFromColor(r, g, b, a)).toEqual({ echo: true, dbz: null });
    for (const v of [-99, -999, -3, NaN]) expect(colorForDbz(v)[3]).toBe(0);
  });

  test("圖的範圍含 TWD67 平移，涵蓋本島與離島", () => {
    const { lon0, res } = RADAR_GRID;
    expect(RADAR_EXTENT[0]).toBeCloseTo(lon0 + (RADAR_REGION.col0 - 0.5) * res + TWD67_SHIFT.lon, 9);
    expect(isInRadarExtent(YANGMINGSHAN)).toBe(true);
    expect(isInRadarExtent([118.3, 24.4, 118.45, 24.5])).toBe(true); // 金門
    expect(isInRadarExtent([139.7, 35.6, 139.8, 35.7])).toBe(false);
    expect(isInRadarExtent([NaN, 25, 121, 25.1])).toBe(false);
  });
});

test.describe("取景", () => {
  test("投影：範圍四角落在地圖四角，東西南北等比例", () => {
    const [x0, y0] = projectToView(RADAR_EXTENT[3], RADAR_EXTENT[0]);
    const [x1, y1] = projectToView(RADAR_EXTENT[1], RADAR_EXTENT[2]);
    expect(x0).toBeCloseTo(0, 9);
    expect(y0).toBeCloseTo(0, 9);
    expect(x1).toBeCloseTo(RADAR_VIEW.width, 9);
    expect(y1).toBeCloseTo(RADAR_VIEW.height, 9);
    expect(RADAR_VIEW.width / RADAR_VIEW.height).toBeCloseTo(Math.cos((24 * Math.PI) / 180), 2);
  });

  test("周邊：包住路線，直式橫式的短邊都至少約 60 km", () => {
    const [, , wide, low] = radarViewBox(YANGMINGSHAN, "near", 2.3, { top: 0.15, bottom: 0.35 });
    expect(low).toBeGreaterThanOrEqual(55 - 1e-9);
    expect(wide).toBeGreaterThan(low);
    const r = viewRectOf(YANGMINGSHAN);
    const [x, y, w, h] = radarViewBox(YANGMINGSHAN, "near", 0.5, { top: 0, bottom: 0.25 });
    expect(w / h).toBeCloseTo(0.5, 6);
    expect(w).toBeGreaterThanOrEqual(55 - 1e-9);
    expect(x).toBeLessThanOrEqual(r.minX);
    expect(x + w).toBeGreaterThanOrEqual(r.maxX);
    expect(y).toBeLessThanOrEqual(r.minY);
    expect(y + h).toBeGreaterThanOrEqual(r.maxY);
  });

  test("全台：寬螢幕看得到整個本島", () => {
    const north = projectToView(25.3, 121.5)[1];
    const south = projectToView(21.9, 120.85)[1];
    const [, y, , h] = radarViewBox(YANGMINGSHAN, "taiwan", 0.6, { top: 0, bottom: 0 });
    expect(y).toBeLessThanOrEqual(north);
    expect(y + h).toBeGreaterThanOrEqual(south);
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
    inside(fitViewBox({ minX: 0, minY: 0, maxX: RADAR_VIEW.width, maxY: RADAR_VIEW.height }, 4 / 3, { top: 0.35, bottom: 0.25 }));
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
