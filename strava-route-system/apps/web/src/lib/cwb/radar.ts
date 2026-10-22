/**
 * CWA 雷達整合回波（O-A0058-006 鄰近地區透明圖層）：純函式
 * 只用來「顯示」，不參與判定（判定仍只看規則式的預報、雨量站與路況）。
 *
 * O-A0058-006：3600×3600 PNG，東經 118–124、北緯 20.5–26.5，等經緯度投影，每 10 分鐘更新。
 * 每個像素是 O-A0059-001 格點（0.0125°）dBZ 依 CWA 色階上色，沒有回波為透明。
 * 座標系是 TWD67，與路線（WGS84）差約 800 m，裁切時先平移。
 */

/** 透明圖層的涵蓋範圍與尺寸（取自資料集說明 LongitudeRange／LatitudeRange／ImageDimension） */
export const RADAR_IMAGE = {
  minLon: 118,
  maxLon: 124,
  minLat: 20.5,
  maxLat: 26.5,
  size: 3600,
} as const;

/** 觀測時間超過此值就不顯示（未判定 ≠ 安全：寧可說「暫無」也不放舊圖） */
export const RADAR_STALE_MS = 30 * 60 * 1000;

/**
 * TWD67 → WGS84（TWD97）在臺灣本島的近似平移：E +828 m、N −207 m。
 * 換成經緯度：WGS84 經度 = TWD67 + 0.0082°，緯度 = TWD67 − 0.0019°。
 */
export const TWD67_SHIFT = { lon: 0.0082, lat: -0.0019 } as const;

/**
 * 裁切圖固定寬 2.4:1（以公里計），比桌機主視覺還寬；手機與子母畫面再由 fitViewBox 依容器比例取景，
 * 所有裝置共用同一張圖（同一個 CDN 快取）。
 */
export const RADAR_ASPECT = 2.4;
/** 地圖 SVG 的座標尺寸（與 RADAR_ASPECT 同比例）；雷達圖、鄉鎮界、路線都投影到這個座標 */
export const RADAR_VIEW = { width: 480, height: 200 } as const;
/** 南北留路線高度的倍數（判定與底部列會蓋住上下），東西的倍數，與最小涵蓋範圍（緯度約 22 km） */
const LAT_PAD = 3.2;
const LON_PAD = 1.6;
const MIN_LAT_SPAN = 0.2;

export type Extent = [minLon: number, minLat: number, maxLon: number, maxLat: number];

/** GET /api/radar 的回應 */
export interface RadarResponse {
  /** 觀測時間（ISO，+08:00） */
  observedAt: string;
  /** 圖的範圍（WGS84） */
  extent: Extent;
  /** 裁切後的透明 PNG（data URL，客戶端可在同源 canvas 取色） */
  image: string;
  /** 鄉鎮界，座標為 RADAR_VIEW 寬高 */
  towns: string;
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

export interface RadarCrop {
  /** 裁切範圍（WGS84），路線與鄉鎮界以此投影 */
  extent: Extent;
  /** 在 O-A0058-006 原圖上的像素範圍 */
  pixel: { left: number; top: number; width: number; height: number };
}

const toPxX = (lon67: number) =>
  ((lon67 - RADAR_IMAGE.minLon) / (RADAR_IMAGE.maxLon - RADAR_IMAGE.minLon)) * RADAR_IMAGE.size;
const toPxY = (lat67: number) =>
  ((RADAR_IMAGE.maxLat - lat67) / (RADAR_IMAGE.maxLat - RADAR_IMAGE.minLat)) * RADAR_IMAGE.size;
const fromPxX = (px: number) =>
  RADAR_IMAGE.minLon + (px / RADAR_IMAGE.size) * (RADAR_IMAGE.maxLon - RADAR_IMAGE.minLon);
const fromPxY = (py: number) =>
  RADAR_IMAGE.maxLat - (py / RADAR_IMAGE.size) * (RADAR_IMAGE.maxLat - RADAR_IMAGE.minLat);

/**
 * 依路線範圍（WGS84）算出雷達圖裁切：外擴、補到 4:3、換成 TWD67 像素並取整，
 * 再以整數像素反推回 WGS84 範圍，確保路線與圖完全對齊。超出圖層範圍回 null。
 */
export function radarCropFor(bbox: Extent): RadarCrop | null {
  const [minLon, minLat, maxLon, maxLat] = bbox;
  if (![minLon, minLat, maxLon, maxLat].every(Number.isFinite) || minLon > maxLon || minLat > maxLat) {
    return null;
  }
  const cLon = (minLon + maxLon) / 2;
  const cLat = (minLat + maxLat) / 2;
  const cos = Math.cos((cLat * Math.PI) / 180);
  // 先以公里比例（經度乘 cos）外擴，再補成 RADAR_ASPECT
  let latSpan = Math.max((maxLat - minLat) * LAT_PAD, MIN_LAT_SPAN);
  let lonSpanKm = Math.max((maxLon - minLon) * cos * LON_PAD, latSpan * RADAR_ASPECT);
  latSpan = Math.max(latSpan, lonSpanKm / RADAR_ASPECT);
  lonSpanKm = latSpan * RADAR_ASPECT;
  const lonSpan = lonSpanKm / cos;

  // WGS84 → TWD67 後換成原圖像素，向外取整
  const left = Math.floor(toPxX(cLon - lonSpan / 2 - TWD67_SHIFT.lon));
  const right = Math.ceil(toPxX(cLon + lonSpan / 2 - TWD67_SHIFT.lon));
  const top = Math.floor(toPxY(cLat + latSpan / 2 - TWD67_SHIFT.lat));
  const bottom = Math.ceil(toPxY(cLat - latSpan / 2 - TWD67_SHIFT.lat));
  if (left < 0 || top < 0 || right > RADAR_IMAGE.size || bottom > RADAR_IMAGE.size) return null;

  return {
    extent: [
      fromPxX(left) + TWD67_SHIFT.lon,
      fromPxY(bottom) + TWD67_SHIFT.lat,
      fromPxX(right) + TWD67_SHIFT.lon,
      fromPxY(top) + TWD67_SHIFT.lat,
    ],
    pixel: { left, top, width: right - left, height: bottom - top },
  };
}

/** WGS84 經緯度 → 裁切圖上的相對位置（0–1，左上為原點）；地圖、鄉鎮界、取色共用 */
export function projectToExtent(extent: Extent, lat: number, lon: number): [x: number, y: number] {
  const [minLon, minLat, maxLon, maxLat] = extent;
  return [(lon - minLon) / (maxLon - minLon), (maxLat - lat) / (maxLat - minLat)];
}

/** 取景時上下被蓋住的比例（0–1）：主視覺上方是判定，下方是圖例與說明列 */
export interface ViewInsets {
  top: number;
  bottom: number;
}

/**
 * 依容器長寬比在 RADAR_VIEW 裡取景：路線放在上下沒被蓋住的那一段正中間，
 * 並盡量完整入鏡（左右留 10%）；超出圖的部分貼齊邊界。回傳 SVG viewBox 的 [x, y, w, h]。
 */
export function fitViewBox(
  route: { minX: number; minY: number; maxX: number; maxY: number },
  aspect: number,
  insets: ViewInsets
): [x: number, y: number, w: number, h: number] {
  const { width: W, height: H } = RADAR_VIEW;
  const band = Math.max(0.2, 1 - insets.top - insets.bottom);
  const routeW = Math.max(route.maxX - route.minX, 1);
  const routeH = Math.max(route.maxY - route.minY, 1);
  let h = Math.max(routeH / band, routeW / 0.8 / aspect);
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
  const cx = (route.minX + route.maxX) / 2;
  const cy = (route.minY + route.maxY) / 2;
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
