/**
 * CWA 雷達合成回波：純函式
 * 只用來「顯示」，不參與判定（判定仍只看規則式的預報、雨量站與路況）。
 *
 * 來源是 CWA 公開 S3 的歷史檔 history/Observation/<YYYYMMDDHHmm>compref_mosaic.xml（台灣時間，
 * 內容即 O-A0059-001）：每 10 分鐘一筆、保留約兩週、不需金鑰，所以能回放過去一小時。
 * 格點 921×881、0.0125°（約 1.3 km），左下角東經 115、北緯 18，先西向東再南向北；
 * 值為 dBZ，-99 沒有回波，-999 雷達範圍外或品管移除。座標系是 TWD67，與路線（WGS84）差約 800 m。
 */

/** 格點規格（取自資料說明，伺服器解析時逐項核對） */
export const RADAR_GRID = { lon0: 115, lat0: 18, res: 0.0125, nx: 921, ny: 881 } as const;

/**
 * 畫成圖的範圍（格點索引，含頭不含尾）：東經約 118–123、北緯約 21.5–26.5，
 * 涵蓋本島、澎湖、金門、馬祖，圖為 400×400，左上為北、西。
 */
export const RADAR_REGION = { col0: 240, col1: 640, row0: 280, row1: 680 } as const;
export const RADAR_IMAGE_SIZE = {
  width: RADAR_REGION.col1 - RADAR_REGION.col0,
  height: RADAR_REGION.row1 - RADAR_REGION.row0,
} as const;

/** 觀測時間超過此值就不顯示（未判定 ≠ 安全：寧可說「暫無」也不放舊圖） */
export const RADAR_STALE_MS = 30 * 60 * 1000;
/** 回放張數：最新一張往前一小時（每 10 分鐘一張） */
export const RADAR_FRAME_COUNT = 7;

/**
 * TWD67 → WGS84（TWD97）在臺灣本島的近似平移：E +828 m、N −207 m。
 * 換成經緯度：WGS84 經度 = TWD67 + 0.0082°，緯度 = TWD67 − 0.0019°。
 */
export const TWD67_SHIFT = { lon: 0.0082, lat: -0.0019 } as const;

export type Extent = [minLon: number, minLat: number, maxLon: number, maxLat: number];

/** 雷達圖的範圍（WGS84）：每個像素以格點為中心，四周各多半格 */
export const RADAR_EXTENT: Extent = (() => {
  const { lon0, lat0, res } = RADAR_GRID;
  const { col0, col1, row0, row1 } = RADAR_REGION;
  return [
    lon0 + (col0 - 0.5) * res + TWD67_SHIFT.lon,
    lat0 + (row0 - 0.5) * res + TWD67_SHIFT.lat,
    lon0 + (col1 - 0.5) * res + TWD67_SHIFT.lon,
    lat0 + (row1 - 0.5) * res + TWD67_SHIFT.lat,
  ];
})();

/**
 * 地圖 SVG 座標：0.01° 緯度為 1 單位（約 1.1 km），經度乘上 cos(24°) 讓東西南北等比例。
 * 雷達圖、鄉鎮界、路線都投影到這個座標，取景（縮放）只改 viewBox。
 */
const VIEW_COS = Math.cos((24 * Math.PI) / 180);
const VIEW_UNITS_PER_DEG = 100;
export const RADAR_VIEW = {
  width: (RADAR_EXTENT[2] - RADAR_EXTENT[0]) * VIEW_UNITS_PER_DEG * VIEW_COS,
  height: (RADAR_EXTENT[3] - RADAR_EXTENT[1]) * VIEW_UNITS_PER_DEG,
} as const;

/** WGS84 經緯度 → 地圖 SVG 座標 */
export function projectToView(lat: number, lon: number): [x: number, y: number] {
  const [x, y] = projectToExtent(RADAR_EXTENT, lat, lon);
  return [x * RADAR_VIEW.width, y * RADAR_VIEW.height];
}

/** 一張雷達圖 */
export interface RadarFrame {
  /** 歷史檔的時間戳 YYYYMMDDHHmm（台灣時間），也是 /api/radar/frames/[id] 的 id */
  id: string;
  /** 觀測時間（ISO，+08:00） */
  observedAt: string;
}

/** GET /api/radar 的回應：可回放的圖，舊到新 */
export interface RadarManifest {
  frames: RadarFrame[];
}

const FRAME_ID = /^\d{12}$/;
const HISTORY_KEY = /(\d{12})compref_mosaic\.xml$/;

export function isRadarFrameId(id: string): boolean {
  return FRAME_ID.test(id) && Number.isFinite(Date.parse(observedAtOfFrameId(id)));
}

/** 202610222350 → 2026-10-22T23:50:00+08:00 */
export function observedAtOfFrameId(id: string): string {
  return `${id.slice(0, 4)}-${id.slice(4, 6)}-${id.slice(6, 8)}T${id.slice(8, 10)}:${id.slice(10, 12)}:00+08:00`;
}

/** 列出歷史檔要查的前綴：台灣時間的今天與昨天（剛過午夜時，前一小時在昨天） */
export function historyDatePrefixes(now: number): string[] {
  const day = (t: number) => new Date(t + 8 * 3600 * 1000).toISOString().slice(0, 10).replaceAll("-", "");
  return [...new Set([day(now - 24 * 3600 * 1000), day(now)])];
}

/**
 * 由 S3 物件名稱挑出最新 count 張雷達圖（舊到新）；
 * 只取與最新一張相差一小時內的，中間缺圖就少幾張，不補舊圖。
 */
export function latestRadarFrames(keys: string[], count = RADAR_FRAME_COUNT): RadarFrame[] {
  const ids = [...new Set(keys.map((k) => HISTORY_KEY.exec(k)?.[1]).filter((id): id is string => !!id && isRadarFrameId(id)))].sort();
  const latest = ids.at(-1);
  if (!latest) return [];
  const latestMs = Date.parse(observedAtOfFrameId(latest));
  return ids
    .slice(-count)
    .filter((id) => latestMs - Date.parse(observedAtOfFrameId(id)) <= (count - 1) * 10 * 60 * 1000)
    .map((id) => ({ id, observedAt: observedAtOfFrameId(id) }));
}

/** 解析後的合成回波格點：values 依原檔順序（列由南到北） */
export interface CompositeGrid {
  observedAt: string;
  values: Float32Array;
}

function tagValue(xml: string, tag: string): string | null {
  const m = new RegExp(`<${tag}>\\s*([^<]*?)\\s*</${tag}>`).exec(xml);
  return m ? m[1]! : null;
}

/**
 * 解析 compref_mosaic.xml。格點起點、解析度、尺寸任何一項與 RADAR_GRID 不同就丟錯：
 * 對不上位置的圖寧可不顯示。
 */
export function parseCompositeReflectivity(xml: string): CompositeGrid {
  const { lon0, lat0, res, nx, ny } = RADAR_GRID;
  const ok =
    Number(tagValue(xml, "StartPointLongitude")) === lon0 &&
    Number(tagValue(xml, "StartPointLatitude")) === lat0 &&
    Number(tagValue(xml, "GridResolution")) === res &&
    Number(tagValue(xml, "GridDimensionX")) === nx &&
    Number(tagValue(xml, "GridDimensionY")) === ny;
  const observedAt = tagValue(xml, "DateTime");
  if (!ok || !observedAt || !Number.isFinite(Date.parse(observedAt))) throw new Error("雷達格點格式與預期不符");
  const start = xml.indexOf("<content>");
  const end = xml.indexOf("</content>", start);
  if (start < 0 || end < 0) throw new Error("雷達格點沒有內容");
  const parts = xml.slice(start + "<content>".length, end).split(",");
  if (parts.length !== nx * ny) throw new Error(`雷達格點數量不符：${parts.length}`);
  const values = new Float32Array(parts.length);
  for (let i = 0; i < parts.length; i++) values[i] = parseFloat(parts[i]!);
  return { observedAt, values };
}

/** 超過色階（52 dBZ 以上）的顏色；dbzFromColor 對不上色階，只說「回波很強」不猜數值 */
export const STRONG_ECHO_COLOR: readonly [number, number, number] = [171, 0, 255];

/** dBZ → RGBA；沒有回波、雷達範圍外（負值、-99、-999、NaN）為透明 */
export function colorForDbz(dbz: number): [number, number, number, number] {
  if (!(dbz >= 0)) return [0, 0, 0, 0];
  const c = dbz >= DBZ_COLORS.length ? STRONG_ECHO_COLOR : DBZ_COLORS[Math.floor(dbz)]!;
  return [c[0], c[1], c[2], 255];
}

/** 把 RADAR_REGION 畫成 RGBA（上北下南），伺服器再編成 PNG */
export function renderRadarRegion(values: Float32Array): Uint8Array {
  const { nx } = RADAR_GRID;
  const { col0, row1 } = RADAR_REGION;
  const { width, height } = RADAR_IMAGE_SIZE;
  const out = new Uint8Array(width * height * 4);
  for (let py = 0; py < height; py++) {
    const row = row1 - 1 - py;
    for (let px = 0; px < width; px++) {
      out.set(colorForDbz(values[row * nx + col0 + px]!), (py * width + px) * 4);
    }
  }
  return out;
}

/** 路線點（[lat, lon]）的範圍；沒有點回 null */
export function bboxOfPoints(points: [number, number][]): Extent | null {
  if (points.length === 0) return null;
  let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
  for (const [lat, lon] of points) {
    minLon = Math.min(minLon, lon);
    maxLon = Math.max(maxLon, lon);
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
  }
  return [minLon, minLat, maxLon, maxLat];
}

/** 路線整條都在雷達圖範圍內 */
export function isInRadarExtent(bbox: Extent): boolean {
  const [minLon, minLat, maxLon, maxLat] = bbox;
  const [eMinLon, eMinLat, eMaxLon, eMaxLat] = RADAR_EXTENT;
  return (
    [minLon, minLat, maxLon, maxLat].every(Number.isFinite) &&
    minLon >= eMinLon && maxLon <= eMaxLon && minLat >= eMinLat && maxLat <= eMaxLat
  );
}

/** WGS84 經緯度 → 範圍內的相對位置（0–1，左上為原點）；地圖、鄉鎮界、取色共用 */
export function projectToExtent(extent: Extent, lat: number, lon: number): [x: number, y: number] {
  const [minLon, minLat, maxLon, maxLat] = extent;
  return [(lon - minLon) / (maxLon - minLon), (maxLat - lat) / (maxLat - minLat)];
}

/** 取景時上下被蓋住的比例（0–1）：主視覺上方是判定，下方是播放列 */
export interface ViewInsets {
  top: number;
  bottom: number;
}

export type ViewBox = [x: number, y: number, w: number, h: number];
type ViewRect = { minX: number; minY: number; maxX: number; maxY: number };

/** 取景範圍：「周邊」看路線附近約 70 km，「全台」看整個本島與澎湖 */
export type RadarZoom = "near" | "taiwan";
/** 周邊至少涵蓋的南北範圍（地圖單位，約 0.7° ≈ 77 km），雨帶一小時移動的距離看得到 */
const NEAR_MIN_HEIGHT = 70;
/** 本島＋澎湖（WGS84） */
const TAIWAN_BOX: Extent = [119.3, 21.85, 122.05, 25.35];

/** 經緯度範圍 → 地圖座標的矩形 */
export function viewRectOf(bbox: Extent): ViewRect {
  const [x0, y1] = projectToView(bbox[1], bbox[0]);
  const [x1, y0] = projectToView(bbox[3], bbox[2]);
  return { minX: x0, minY: y0, maxX: x1, maxY: y1 };
}

/** 依取景範圍算 viewBox：周邊以路線為中心，全台則包住本島與路線 */
export function radarViewBox(routeBox: Extent | null, zoom: RadarZoom, aspect: number, insets: ViewInsets): ViewBox {
  if (zoom === "taiwan" || !routeBox) {
    const r = viewRectOf(TAIWAN_BOX);
    const route = routeBox ? viewRectOf(routeBox) : r;
    return fitViewBox(
      {
        minX: Math.min(r.minX, route.minX),
        minY: Math.min(r.minY, route.minY),
        maxX: Math.max(r.maxX, route.maxX),
        maxY: Math.max(r.maxY, route.maxY),
      },
      aspect,
      insets
    );
  }
  return fitViewBox(viewRectOf(routeBox), aspect, insets, NEAR_MIN_HEIGHT);
}

/**
 * 依容器長寬比在 RADAR_VIEW 裡取景：目標放在上下沒被蓋住的那一段正中間，
 * 並盡量完整入鏡（左右留 10%）；超出圖的部分貼齊邊界。回傳 SVG viewBox 的 [x, y, w, h]。
 */
export function fitViewBox(target: ViewRect, aspect: number, insets: ViewInsets, minHeight = 0): ViewBox {
  const { width: W, height: H } = RADAR_VIEW;
  const band = Math.max(0.2, 1 - insets.top - insets.bottom);
  const targetW = Math.max(target.maxX - target.minX, 1);
  const targetH = Math.max(target.maxY - target.minY, 1);
  let h = Math.max(targetH / band, targetW / 0.8 / aspect, minHeight);
  let w = h * aspect;
  // 圖不夠大時縮回圖內，維持比例
  if (w > W) {
    w = W;
    h = w / aspect;
  }
  if (h > H) {
    h = H;
    w = h * aspect;
  }
  const cx = (target.minX + target.maxX) / 2;
  const cy = (target.minY + target.maxY) / 2;
  const clamp = (v: number, max: number) => Math.min(Math.max(v, 0), Math.max(max, 0));
  const x = clamp(cx - w / 2, W - w);
  const y = clamp(cy - h * (insets.top + band / 2), H - h);
  return [x, y, w, h];
}

/** 路線上某里程的經緯度（線性內插）；points 為 [lat, lon]，cumulativeKm 與之等長 */
export function pointAtKm(
  points: [number, number][],
  cumulativeKm: number[],
  km: number
): [lat: number, lon: number] | null {
  if (points.length === 0 || points.length !== cumulativeKm.length) return null;
  if (km <= cumulativeKm[0]!) return points[0]!;
  for (let i = 1; i < points.length; i++) {
    const k1 = cumulativeKm[i]!;
    if (km <= k1) {
      const k0 = cumulativeKm[i - 1]!;
      const t = k1 > k0 ? (km - k0) / (k1 - k0) : 0;
      const [a0, o0] = points[i - 1]!;
      const [a1, o1] = points[i]!;
      return [a0 + (a1 - a0) * t, o0 + (o1 - o0) * t];
    }
  }
  return points[points.length - 1]!;
}

/**
 * CWA 回波色階：索引即 dBZ（0–52），由 O-A0058-006 像素與 O-A0059-001 格點逐點比對而得。
 * 超過 52 dBZ 的顏色資料中未出現，查不到時不猜數值（見 dbzFromColor）。
 */
export const DBZ_COLORS: readonly [number, number, number][] = [
  [0, 255, 255], [0, 236, 255], [0, 218, 255], [0, 200, 255], [0, 182, 255],
  [0, 163, 255], [0, 145, 255], [0, 127, 255], [0, 109, 255], [0, 91, 255],
  [0, 72, 255], [0, 54, 255], [0, 36, 255], [0, 18, 255], [0, 0, 255],
  [0, 255, 0], [0, 244, 0], [0, 233, 0], [0, 222, 0], [0, 211, 0],
  [0, 200, 0], [0, 190, 0], [0, 180, 0], [0, 170, 0], [0, 160, 0],
  [0, 150, 0], [51, 171, 0], [102, 192, 0], [153, 213, 0], [204, 234, 0],
  [255, 255, 0], [255, 244, 0], [255, 233, 0], [255, 222, 0], [255, 211, 0],
  [255, 200, 0], [255, 184, 0], [255, 168, 0], [255, 152, 0], [255, 136, 0],
  [255, 120, 0], [255, 96, 0], [255, 72, 0], [255, 48, 0], [255, 24, 0],
  [255, 0, 0], [244, 0, 0], [233, 0, 0], [222, 0, 0], [211, 0, 0],
  [200, 0, 0], [190, 0, 0], [180, 0, 0],
];

/** 顏色差距超過此值就視為色階外的顏色 */
const COLOR_TOLERANCE = 12;

/**
 * 像素顏色 → 回波：
 * - 透明：沒有回波（dbz 為 null，echo 為 false）
 * - 對得上色階：dbz 為對應值
 * - 不透明但對不上（例如更強回波的色階）：echo 為 true、dbz 為 null，不猜數值也不當成沒雨
 */
export function dbzFromColor(r: number, g: number, b: number, a: number): { echo: boolean; dbz: number | null } {
  if (a < 128) return { echo: false, dbz: null };
  let best = -1;
  let bestDist = Infinity;
  DBZ_COLORS.forEach(([cr, cg, cb], i) => {
    const d = Math.abs(cr - r) + Math.abs(cg - g) + Math.abs(cb - b);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  });
  return bestDist <= COLOR_TOLERANCE ? { echo: true, dbz: best } : { echo: true, dbz: null };
}

/** dBZ → 降雨強度 mm/h（Marshall–Palmer Z = 200 R^1.6）；只作「大約多大」的說明 */
export function rainRateFromDbz(dbz: number): number {
  return Math.pow(Math.pow(10, dbz / 10) / 200, 1 / 1.6);
}

/** 降雨強度 mm/h → dBZ（rainRateFromDbz 的反函數），圖例刻度用 */
export function dbzFromRainRate(mmPerHr: number): number {
  return 10 * Math.log10(200 * Math.pow(mmPerHr, 1.6));
}

/** 「約 3 mm/h」這類文字；不到 1 mm/h 寫「不到 1 mm/h」 */
export function rainRateLabel(dbz: number): string {
  const r = rainRateFromDbz(dbz);
  if (r < 1) return "不到 1 mm/h";
  return `約 ${r < 10 ? Math.round(r * 10) / 10 : Math.round(r)} mm/h`;
}

/** 圖例：色階 0–52 dBZ，刻度標在常見雨量（mm/h）的位置 */
export const LEGEND_MAX_DBZ = DBZ_COLORS.length - 1;
export const LEGEND_TICKS_MM = [1, 3, 10, 25] as const;

export function legendTicks(): { mm: number; pct: number }[] {
  return LEGEND_TICKS_MM.map((mm) => ({ mm, pct: (dbzFromRainRate(mm) / LEGEND_MAX_DBZ) * 100 }));
}

/** 觀測時間是否已過期；解析不了的時間一律當過期 */
export function isRadarStale(observedAt: string, now = Date.now()): boolean {
  const t = Date.parse(observedAt);
  return !Number.isFinite(t) || now - t > RADAR_STALE_MS;
}
