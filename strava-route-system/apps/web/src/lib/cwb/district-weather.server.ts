/**
 * 中央氣象署（CWB）鄉鎮天氣：預報、日落、即時雨量
 * 伺服器端專用（需 CWB_API_KEY），供 Server Component 與判讀使用。
 */

import { getCWBdatasetId, normalizeCountyForCWB } from "@/lib/cwb/county-map";
import { isForecastStale } from "@/lib/cwb/forecast-freshness";
import { windBucketsFromCwb, type WindBucket } from "@/lib/cwb/forecast-eta";
import {
  parseRainfallStations,
  summarizeRainfall,
  type LatLon,
  type RainfallSummary,
  type StationRain,
} from "@/lib/cwb/rainfall-stations";

const CWB_BASE = "https://opendata.cwa.gov.tw/api/v1/rest/datastore";
const TIME_ZONE = "Asia/Taipei";

export type CWBWeatherCondition = "sunny" | "cloudy" | "rainy" | "stormy" | "snowy";

const CONDITION_VALUES: CWBWeatherCondition[] = ["sunny", "cloudy", "rainy", "stormy", "snowy"];

/** CWB 天氣現象（中文）→ condition */
const WEATHER_TEXT_MAP: Record<string, CWBWeatherCondition> = {
  晴: "sunny",
  多雲: "cloudy",
  陰: "cloudy",
  雨: "rainy",
  雷: "stormy",
  雪: "snowy",
};

function resolveCondition(conditionOrWeather?: string, weatherText?: string): CWBWeatherCondition {
  const c = (conditionOrWeather ?? "").toLowerCase();
  if (CONDITION_VALUES.includes(c as CWBWeatherCondition)) return c as CWBWeatherCondition;
  for (const [key, val] of Object.entries(WEATHER_TEXT_MAP)) {
    if (weatherText?.includes(key)) return val;
  }
  return "cloudy";
}

export type CWBWeatherResponse = {
  temperature: number;
  feelsLike: number;
  condition: CWBWeatherCondition;
  description: string;
  windSpeed: number;
  windSpeedKmh: number;
  humidity: number;
  uvIndex: number;
  uvLevel: string;
  sunset: string;
  rainfall12h: Array<{ startTime: string; endTime: string; pop: number; label: string; endLabel: string }>;
  /** 風速時段（km/h），判讀依各路段 ETA 挑選 */
  windBuckets: WindBucket[];
  /** 重抓後仍是過期預報；判讀端須改判 unknown（stale） */
  stale: boolean;
  verdict: string;
  verdictType: "good" | "caution" | "bad";
  /** 即時時雨量（mm/hr）；rainfallScope 為 county 時是整個縣市測站的最大值，不代表該地點 */
  rainfallMmPerHr: number | null;
  rainfallScope: RainfallSummary["scope"];
};

/** 對應 HTTP 狀態的錯誤，供 API route 轉成回應 */
export class CwbError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly detail?: unknown
  ) {
    super(message);
    this.name = "CwbError";
  }
}

type WeatherElement = {
  ElementName?: string;
  Time?: Array<{ StartTime?: string; EndTime?: string; DataTime?: string; ElementValue?: Array<Record<string, string>> }>;
};

type CWBLocation = {
  LocationName?: string;
  WeatherElement?: WeatherElement[];
};

/** 去掉鄉鎮市區後綴並統一「臺」：舊制「金山鄉」「三重市」可對上 CWB 的「金山區」「三重區」 */
const districtStem = (name: string) => name.replace(/台/g, "臺").replace(/[鄉鎮市區]$/, "");

/** 未指定 district 時取縣市第一個鄉鎮；有指定卻找不到時回 undefined，不改用別區天氣 */
function pickLocation(arr: CWBLocation[] | undefined, district?: string): CWBLocation | undefined {
  if (!arr?.length) return undefined;
  if (!district) return arr[0];
  const target = districtStem(district);
  return arr.find((loc) => loc.LocationName && districtStem(loc.LocationName) === target);
}

function getElementValue(elements: WeatherElement[] | undefined, name: string): Record<string, string> | undefined {
  if (!elements?.length) return undefined;
  const item = elements.find((e) => e.ElementName === name);
  const firstTime = item?.Time?.[0];
  return firstTime?.ElementValue?.[0];
}

/** 降雨判斷：雨量 mm/hr → verdict，windMs 用於雨+風體感判斷 */
function computeVerdict(
  temp: number,
  pop: number,
  uv: number,
  windMs: number,
  rainfallMmPerHr: number | null
): { verdict: string; verdictType: "good" | "caution" | "bad" } {
  const rain = rainfallMmPerHr;
  const hasRainData = rain !== null;

  // 中雨 2.6+ / 大雨 >8：不論機率，不適合或嚴禁
  if (hasRainData && rain >= 2.6) {
    if (rain > 8) return { verdict: "大雨，嚴禁戶外運動", verdictType: "bad" };
    return { verdict: "中雨，不適合戶外運動", verdictType: "bad" };
  }

  // 雨量 > 0.5 且 風速 > 10 m/s → 體感嚴寒，不適合
  if (hasRainData && rain > 0.5 && windMs > 10) {
    return { verdict: "雨勢加上強風，體感寒冷，不適合戶外運動", verdictType: "bad" };
  }

  // 自動忽略：雨量 < 0.5 mm/hr，不論 PoP → 適合
  if (hasRainData && rain < 0.5) {
    const msg = rain < 0.1 ? "微量降雨，適合運動" : "毛毛雨，適合運動";
    return { verdict: msg, verdictType: "good" };
  }

  // 警示：PoP >= 70% 且 雨量 >= 1.0 mm/hr → 不適合
  if (pop >= 70 && (rain === null || rain >= 1)) {
    return { verdict: "高降雨機率，不建議戶外運動", verdictType: "bad" };
  }

  // 小雨 0.5–2.5：尚可跑步，不適球類
  if (hasRainData && rain >= 0.5 && rain <= 2.5) {
    return { verdict: "小雨，尚可跑步，不建議球類運動", verdictType: "caution" };
  }

  // 其他 bad 條件
  const bad: string[] = [];
  if (uv >= 8) bad.push("高紫外線");
  if (windMs > 10) bad.push("風速較強");
  if (temp >= 35 || temp <= 5) bad.push("溫度極端");
  if (bad.length > 0) return { verdict: bad.join("，不建議戶外運動"), verdictType: "bad" };

  // 一般 caution
  if (pop >= 40 || uv >= 6) return { verdict: "注意防曬與降雨", verdictType: "caution" };
  return { verdict: "適合戶外運動", verdictType: "good" };
}

const timeLabel = (iso: string) =>
  iso ? new Date(iso).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: TIME_ZONE }) : "—";

/** O-A0002 自動雨量站；getDistrictWeather 與 getCountyRainfallStations 用同一網址以共用 fetch 快取 */
const rainfallUrl = (auth: string, cwbCounty: string) =>
  `${CWB_BASE}/O-A0002-002?${auth}&format=JSON&locationName=${encodeURIComponent(cwbCounty)}`;

/**
 * 縣市內有效時雨量的測站，供呼叫端依各自的座標（如每條路線）篩附近測站。
 * 取不到時回傳 null，呼叫端不可當成「沒有下雨」。
 */
export async function getCountyRainfallStations(county: string): Promise<StationRain[] | null> {
  const key = process.env.CWB_API_KEY;
  if (!key) return null;
  const cwbCounty = normalizeCountyForCWB(county);
  try {
    const res = await fetch(rainfallUrl(`Authorization=${encodeURIComponent(key)}`, cwbCounty), {
      next: { revalidate: 600 },
    });
    return res.ok ? parseRainfallStations(await res.json(), cwbCounty) : null;
  } catch {
    return null;
  }
}

/** 台灣時間的今天（YYYY-MM-DD） */
const todayInTaipei = () => new Date().toLocaleDateString("sv-SE", { timeZone: TIME_ZONE });

/**
 * 取得鄉鎮天氣。county 為縣市（接受「台」「臺」與舊制名稱），district 為鄉鎮區。
 * near 為使用者位置或路線取樣點：提供時即時雨量只採 3 km 內測站，附近沒有測站就不拿雨量判斷。
 * 失敗時丟出 CwbError（帶 HTTP 狀態）。
 */
export async function getDistrictWeather(
  county: string,
  district?: string,
  { near = [] }: { near?: LatLon[] } = {}
): Promise<CWBWeatherResponse> {
  const key = process.env.CWB_API_KEY;
  if (!key) throw new CwbError("CWB_API_KEY 未設定", 500);

  const cwbCounty = normalizeCountyForCWB(county);
  const datasetId = getCWBdatasetId(county);
  if (!datasetId) {
    throw new CwbError(`找不到縣市對應：${county}，請使用繁體中文縣市名（如：新竹縣）`, 400);
  }

  const auth = `Authorization=${encodeURIComponent(key)}`;
  const format = "format=JSON";
  const forecastUrl = `${CWB_BASE}/F-D0047-${datasetId}?${auth}&${format}`;

  let forecastRes: Response;
  let sunsetRes: Response;
  let rainRes: Response;
  try {
    [forecastRes, sunsetRes, rainRes] = await Promise.all([
      fetch(forecastUrl, { next: { revalidate: 3600 } }),
      fetch(`${CWB_BASE}/A-B0062-001?${auth}&${format}`, { next: { revalidate: 86400 } }),
      fetch(rainfallUrl(auth, cwbCounty), { next: { revalidate: 600 } }),
    ]);
  } catch (e) {
    throw new CwbError(`CWB 請求失敗：${e instanceof Error ? e.message : String(e)}`, 500);
  }

  if (!forecastRes.ok) {
    throw new CwbError(`CWB 預報 API 錯誤：${forecastRes.status}`, 502, await forecastRes.text());
  }
  if (!sunsetRes.ok) {
    throw new CwbError(`CWB 日出日落 API 錯誤：${sunsetRes.status}`, 502, await sunsetRes.text());
  }

  let forecastData = await forecastRes.json();
  // 快取給的是舊預報就不走快取重抓，避免把過期預報當成現在
  if (isForecastStale(forecastData)) {
    const freshRes = await fetch(forecastUrl, { cache: "no-store" });
    if (freshRes.ok) forecastData = await freshRes.json();
  }
  const stale = isForecastStale(forecastData);
  let rainfall: RainfallSummary = { mmPerHr: null, scope: "none", stationCount: 0 };
  if (rainRes.ok) {
    try {
      rainfall = summarizeRainfall(parseRainfallStations(await rainRes.json(), cwbCounty), near);
    } catch {
      // 雨量 API 失敗不影響主流程
    }
  }
  // 有指定位置卻沒有附近測站時，縣市最大值不可當成在地雨量拿來判斷
  const localRainMmPerHr = near.length > 0 && rainfall.scope !== "nearby" ? null : rainfall.mmPerHr;
  const sunsetData = await sunsetRes.json();

  const success = forecastData?.success === "true" || forecastData?.success === true;
  if (!success) throw new CwbError("CWB 預報資料異常", 502, forecastData?.result);

  const locations = forecastData?.records?.Locations;
  const locs = Array.isArray(locations) ? locations : locations ? [locations] : [];
  const countyObj = locs[0] as { Location?: CWBLocation[] } | undefined;
  const loc = pickLocation(countyObj?.Location, district);
  if (!loc) throw new CwbError(`找不到行政區：${cwbCounty}${district ?? ""}`, 404);
  if (!loc.WeatherElement?.length) throw new CwbError("無法取得該地區預報", 404);

  const weatherElements: WeatherElement[] = loc.WeatherElement;
  const getVal = (name: string) => getElementValue(weatherElements, name);

  const tempVal = getVal("平均溫度");
  const temp = parseInt(tempVal?.Temperature ?? tempVal?.value ?? "0", 10) || 0;

  const maxAT = getVal("最高體感溫度");
  const minAT = getVal("最低體感溫度");
  const feelsLike =
    Math.round(
      (parseInt(maxAT?.MaxApparentTemperature ?? maxAT?.value ?? "0", 10) +
        parseInt(minAT?.MinApparentTemperature ?? minAT?.value ?? "0", 10)) /
        2
    ) || temp;

  const wx = getVal("天氣現象");
  const condition = resolveCondition(wx?.condition ?? wx?.Condition, wx?.Weather ?? wx?.value);

  const descEl = getVal("天氣預報綜合描述");
  const description = descEl?.WeatherDescription ?? descEl?.value ?? "—";

  const windEl = getVal("風速");
  const windMs = parseFloat(windEl?.WindSpeed ?? windEl?.value ?? "0") || 0;
  const windKmh = Math.round(windMs * 3.6);
  const windBuckets = windBucketsFromCwb(weatherElements.find((e) => e.ElementName === "風速")?.Time);

  const rhEl = getVal("平均相對濕度");
  const humidity = parseInt(rhEl?.RelativeHumidity ?? rhEl?.value ?? "0", 10) || 0;

  const uvEl = getVal("紫外線指數");
  const uvIndex = parseInt(uvEl?.UVIndex ?? uvEl?.value ?? "0", 10) || 0;
  const uvLevel = uvEl?.UVExposureLevel ?? uvEl?.value ?? "—";

  // 優先使用 3 小時細分資料，無則回退 6h → 12h
  const RAINFALL_ELEMENT_NAMES = ["3小時降雨機率", "6小時降雨機率", "12小時降雨機率"] as const;
  const popElName =
    RAINFALL_ELEMENT_NAMES.find((n) => weatherElements.some((e) => e.ElementName === n)) ?? "12小時降雨機率";

  const popEl = getVal(popElName);
  const popFirst = parseInt(popEl?.ProbabilityOfPrecipitation ?? popEl?.value ?? "0", 10) || 0;

  const popTimes = weatherElements.find((e) => e.ElementName === popElName)?.Time ?? [];
  const maxPeriods = popElName === "3小時降雨機率" ? 24 : 12;
  const rainfall12h = popTimes.slice(0, maxPeriods).map((t) => {
    const v = t.ElementValue?.[0];
    const pop = parseInt(v?.ProbabilityOfPrecipitation ?? v?.value ?? "0", 10) || 0;
    const start = t.StartTime ?? "";
    const end = t.EndTime ?? "";
    return { startTime: start, endTime: end, pop, label: timeLabel(start), endLabel: timeLabel(end) };
  });

  const today = todayInTaipei();
  const sunsetLocList = sunsetData?.records?.locations?.location;
  const sunsetLocs = Array.isArray(sunsetLocList) ? sunsetLocList : sunsetLocList ? [sunsetLocList] : [];
  const sunsetLoc =
    sunsetLocs.find((l: { locationName?: string; CountyName?: string }) =>
      (l.locationName ?? l.CountyName ?? "").includes(cwbCounty)
    ) ?? sunsetLocs[0];
  const sunsetTime = sunsetLoc?.time?.find((t: { Date?: string }) => t.Date === today);
  const sunsetStr = sunsetTime?.SunSetTime ?? "17:45";

  const { verdict, verdictType } = computeVerdict(temp, popFirst, uvIndex, windMs, localRainMmPerHr);

  return {
    temperature: temp,
    feelsLike,
    condition,
    description,
    windSpeed: windMs,
    windSpeedKmh: windKmh,
    humidity,
    uvIndex,
    uvLevel,
    sunset: sunsetStr,
    rainfall12h,
    windBuckets,
    stale,
    verdict,
    verdictType,
    rainfallMmPerHr: rainfall.mmPerHr,
    rainfallScope: rainfall.scope,
  };
}
