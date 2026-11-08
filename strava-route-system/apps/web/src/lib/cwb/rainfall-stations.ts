/**
 * CWB 自動雨量站觀測（O-A0002）解析：取路線／位置附近測站的時雨量
 * 不依賴伺服器，可單元測試；抓取在 district-weather.server.ts。
 *
 * 支援兩種格式：
 * - 現行：Station[].GeoInfo.{CountyName, Coordinates[{CoordinateName, StationLatitude, StationLongitude}]}，
 *   RainfallElement.Past1hr.Precipitation
 * - 舊版：Station[] 直接帶 CountyName、StationLatitude/Longitude、Rain／Precipitation 或 WeatherElement
 */

import { haversineKm } from "@/lib/routes/parse-gpx";

/** 測站離路線取樣點／使用者位置多近才算「附近」 */
export const NEARBY_STATION_RADIUS_KM = 3;

export interface LatLon {
  lat: number;
  lon: number;
}

export interface StationRain {
  mmPerHr: number;
  lat?: number;
  lon?: number;
}

export interface RainfallSummary {
  mmPerHr: number | null;
  /**
   * nearby：附近測站的最大時雨量；county：整個縣市測站的最大值（未要求附近、或附近沒有測站）；
   * none：該縣市沒有可用測站
   */
  scope: "nearby" | "county" | "none";
  stationCount: number;
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | undefined => (v && typeof v === "object" ? (v as Obj) : undefined);

/** 負值（-99、-998 等）為測站缺值；X 為儀器故障；T 為雨跡（記為 0） */
function parseMm(v: unknown): number | null {
  if (v == null) return null;
  const s = String(v).trim();
  if (/^t$/i.test(s)) return 0;
  const n = Number(s);
  return s === "" || !Number.isFinite(n) || n < 0 ? null : n;
}

function stationCoords(st: Obj): Partial<LatLon> {
  const coords = obj(st.GeoInfo)?.Coordinates;
  const list = Array.isArray(coords) ? coords.map(obj).filter((c): c is Obj => !!c) : [];
  const c = list.find((x) => x.CoordinateName === "WGS84") ?? list[0] ?? st;
  const lat = Number(c.StationLatitude ?? c.lat);
  const lon = Number(c.StationLongitude ?? c.lon);
  return Number.isFinite(lat) && Number.isFinite(lon) && lat !== 0 && lon !== 0 ? { lat, lon } : {};
}

function stationRain(st: Obj): number | null {
  const past1hr = obj(obj(st.RainfallElement)?.Past1hr)?.Precipitation;
  if (past1hr !== undefined) return parseMm(past1hr);
  const legacy = st.Rain ?? st.rain ?? st.Precipitation ?? st.precipitation;
  if (legacy !== undefined) return parseMm(legacy);
  const elements = Array.isArray(st.WeatherElement) ? (st.WeatherElement as Obj[]) : [];
  const el = elements.find((e) => /雨量|RAIN/i.test(String(e?.ElementName ?? "")));
  const values = el?.ElementValue;
  return parseMm(Array.isArray(values) ? obj(values[0])?.value : undefined);
}

/** 觀測時間比現在早超過此值的測站不採用（O-A0002 每 10 分鐘更新；離線測站會一直停在最後一筆） */
export const STATION_MAX_AGE_MS = 70 * 60_000;

/** 測站觀測時間（epoch ms）；沒有或無法解析回 null */
function stationObsTime(st: Obj): number | null {
  const raw = obj(st.ObsTime)?.DateTime ?? st.ObsTime ?? st.obsTime;
  const t = typeof raw === "string" ? Date.parse(raw) : NaN;
  return Number.isFinite(t) ? t : null;
}

/**
 * 指定縣市（接受台／臺）有有效時雨量的測站。
 * 提供 now 時，觀測時間超過 STATION_MAX_AGE_MS 的測站略過（沒有觀測時間的舊格式照舊採用）。
 */
export function parseRainfallStations(raw: unknown, county: string, now?: number): StationRain[] {
  const target = county.replace(/台/g, "臺");
  const records = obj(obj(raw)?.records);
  const list = records?.Station ?? records?.station;
  const stations = Array.isArray(list) ? list : list ? [list] : [];
  const out: StationRain[] = [];
  for (const s of stations) {
    const st = obj(s);
    if (!st) continue;
    const stationCounty = String(obj(st.GeoInfo)?.CountyName ?? st.CountyName ?? st.countyName ?? "").replace(/台/g, "臺");
    if (!stationCounty.includes(target)) continue;
    const obsAt = now == null ? null : stationObsTime(st);
    if (now != null && obsAt != null && now - obsAt > STATION_MAX_AGE_MS) continue;
    const mmPerHr = stationRain(st);
    if (mmPerHr === null) continue;
    out.push({ mmPerHr, ...stationCoords(st) });
  }
  return out;
}

/**
 * 有提供 near 時取 NEARBY_STATION_RADIUS_KM 內測站的最大時雨量；
 * 附近沒有測站（或沒提供 near）時退回整個縣市的最大值，scope 標為 county，呼叫端不可當成在地雨量。
 */
export function summarizeRainfall(
  stations: StationRain[],
  near: LatLon[] = [],
  radiusKm: number = NEARBY_STATION_RADIUS_KM
): RainfallSummary {
  if (stations.length === 0) return { mmPerHr: null, scope: "none", stationCount: 0 };
  if (near.length > 0) {
    const nearby = stations.filter(
      (s) => s.lat != null && s.lon != null && near.some((p) => haversineKm(p.lat, p.lon, s.lat!, s.lon!) <= radiusKm)
    );
    if (nearby.length > 0) {
      return { mmPerHr: Math.max(...nearby.map((s) => s.mmPerHr)), scope: "nearby", stationCount: nearby.length };
    }
  }
  return { mmPerHr: Math.max(...stations.map((s) => s.mmPerHr)), scope: "county", stationCount: stations.length };
}
