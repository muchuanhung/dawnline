import type { CCTVFeed, Route, RouteSegment } from "@/lib/routes/route-data";
import { encodePolyline } from "@/lib/routes/polyline";

/** 平路，每 0.1 km 一個點 */
export function flatProfile(totalKm = 20, ele = 100): [number, number][] {
  return Array.from({ length: totalKm * 10 + 1 }, (_, i) => [i / 10, ele]);
}

/** 平路中間夾一段 1 km 的坡（grade 為比例，負值為下坡） */
export function slopeProfile(grade: number, startKm = 5, totalKm = 20): [number, number][] {
  return flatProfile(totalKm).map(([km]) => {
    const along = Math.min(Math.max(km - startKm, 0), 1);
    return [km, 100 + along * 1000 * grade];
  });
}

export function segment(
  districtZh: string,
  sampleKms: number[],
  weather: Partial<RouteSegment> = {}
): RouteSegment {
  return {
    district: districtZh,
    districtZh,
    county: "台北市",
    rainProbability: 0,
    windSpeed: 0,
    temperature: 0,
    condition: "clear",
    sampleKms,
    hasWeather: false,
    ...weather,
  };
}

/** 已取得天氣的路段欄位 */
export function withWeather(rain: number, extra: Partial<RouteSegment> = {}): Partial<RouteSegment> {
  return { rainProbability: rain, windSpeed: 5, temperature: 25, hasWeather: true, ...extra };
}

/** 往北的直線路線，polyline 點數與 elevationProfile 一致（每 0.1 km 一點） */
export function makeRoute(overrides: Partial<Route> = {}): Route {
  const elevationProfile = overrides.elevationProfile ?? flatProfile();
  const distance = overrides.distance ?? elevationProfile[elevationProfile.length - 1]![0];
  const points = elevationProfile.map(([km]) => ({ lat: 25.05 + km / 111, lon: 121.55 }));
  return {
    id: "test-route",
    name: "Test Route",
    nameZh: "測試路線",
    bbox: [121.5, 25.0, 121.6, 25.3],
    distance,
    elevationGain: 0,
    type: "自行車",
    difficulty: "中等",
    status: "safe",
    verdictMessage: "",
    segments: [],
    cctvFeeds: [],
    gpxPreviewPath: encodePolyline(points),
    elevationProfile,
    estimatedTime: "1 小時",
    ...overrides,
  };
}

/** 位於路線約 5.5 km 處的鏡頭；tw.live 無法內嵌，畫面只會顯示外連按鈕，不會載入外部影像 */
export const CCTV_FEED: CCTVFeed = {
  id: "static-bot236",
  label: "故宮路-至善路口",
  location: "故宮路-至善路口 (士林區)",
  lastUpdated: "手動維護的鏡頭清單",
  lat: 25.1,
  lon: 121.55,
  imageSeed: 1,
  status: "unknown",
  videoUrl: "https://tw.live/cam/?id=test",
};
