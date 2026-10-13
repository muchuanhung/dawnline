/**
 * 示意路線（demo）：固定排在路線清單第一筆（Storage 讀不到時也是唯一一條），附一組假的 TDX 路況事件
 * 讓 demo 時能看到各類示警。純函式，不依賴伺服器；伺服器端組裝在 load-routes.server.ts。
 *
 * 只有這條路線會帶假事件，真實路線的判讀不受影響；
 * 路線名稱與每筆事件標題都標「示意」，畫面另有 DemoNotice 說明，不可當成實際路況。
 */

import { haversineKm } from "@/lib/routes/parse-gpx";
import { buildRoutePolylineKm } from "@/lib/routes/recon-geo";
import type { RoadEvent } from "@/lib/routes/road-events";
import type { CCTVFeed, Route } from "@/lib/routes/route-data";

export const DEMO_ROUTE_ID = "demo-zhongxiao-e-rd";
export const DEMO_ROUTE_NAME = "示意路線・忠孝東路";
/** 事件標題前綴：示警清單、路況列表都會帶到 */
export const DEMO_EVENT_PREFIX = "示意｜";

export const isDemoRoute = (route: Pick<Route, "id">) => route.id === DEMO_ROUTE_ID;

/** 台北車站 → 南港展覽館，沿忠孝東路的概略折點（lat, lon） */
const WAYPOINTS: [number, number][] = [
  [25.0464, 121.517],
  [25.0446, 121.5235],
  [25.042, 121.533],
  [25.0416, 121.5437],
  [25.0414, 121.551],
  [25.0412, 121.5577],
  [25.041, 121.565],
  [25.0408, 121.5764],
  [25.045, 121.5822],
  [25.0502, 121.5932],
  [25.052, 121.6068],
  [25.0553, 121.6175],
];
/** 加密點距：事件對應路線的門檻是 0.15 km，點太疏會對不上 */
const POINT_SPACING_KM = 0.1;
const DEMO_ELE_M = 10;

/** 折點之間依 POINT_SPACING_KM 線性補點 */
export function demoRoutePoints(): { lat: number; lon: number; ele: number }[] {
  const out: { lat: number; lon: number; ele: number }[] = [];
  for (let i = 1; i < WAYPOINTS.length; i++) {
    const [lat1, lon1] = WAYPOINTS[i - 1]!;
    const [lat2, lon2] = WAYPOINTS[i]!;
    const steps = Math.max(1, Math.ceil(haversineKm(lat1, lon1, lat2, lon2) / POINT_SPACING_KM));
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      out.push({ lat: lat1 + (lat2 - lat1) * t, lon: lon1 + (lon2 - lon1) * t, ele: DEMO_ELE_M });
    }
  }
  const [lat, lon] = WAYPOINTS[WAYPOINTS.length - 1]!;
  out.push({ lat, lon, ele: DEMO_ELE_M });
  return out;
}

/** 示意路線的 GPX，交給 parseGpxToRoute，和真實路線走同一套解析 */
export function demoRouteGpx(): string {
  const pts = demoRoutePoints()
    .map((p) => `<trkpt lat="${p.lat.toFixed(6)}" lon="${p.lon.toFixed(6)}"><ele>${p.ele}</ele></trkpt>`)
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" creator="dawnline-demo"><trk><name>${DEMO_ROUTE_NAME}</name><type>cycling</type><trkseg>${pts}</trkseg></trk></gpx>`;
}

/**
 * 假事件設定：涵蓋 TDX 全部類別，以及不同的生效／到期時段（相對判讀時間）。
 * startH／endH 為相對 now 的小時數；endH 為 null 代表沒有到期時間。
 * 「尚未生效」「已到期」兩筆不會出現在畫面上，用來示範判讀只看當下有效的事件。
 */
const DEMO_EVENTS: {
  key: string;
  type: number;
  subType: number;
  title: string;
  km: number;
  startH: number;
  endH: number | null;
}[] = [
  { key: "disaster", type: 6, subType: 601, title: "落石，外側車道封閉", km: 1.2, startH: -3, endH: 4 },
  { key: "accident", type: 1, subType: 101, title: "機車擦撞，佔用慢車道", km: 2.6, startH: -0.3, endH: 0.7 },
  { key: "control", type: 4, subType: 402, title: "預警性封閉（豪雨）", km: 3.8, startH: -1, endH: 6 },
  { key: "weather", type: 5, subType: 501, title: "濃霧，能見度不佳", km: 5.1, startH: -2, endH: 2 },
  { key: "anomaly", type: 8, subType: 801, title: "路面散落物", km: 6.3, startH: -0.5, endH: null },
  { key: "construction", type: 2, subType: 201, title: "管線施工，縮減一線車道", km: 7.4, startH: -24, endH: 48 },
  { key: "routine", type: 2, subType: 298, title: "道路維護", km: 7.9, startH: -72, endH: null },
  { key: "congestion", type: 3, subType: 301, title: "車多壅塞", km: 8.6, startH: -0.5, endH: 1 },
  { key: "activity", type: 7, subType: 701, title: "路跑活動交通管制", km: 9.4, startH: -1, endH: 3 },
  { key: "upcoming", type: 6, subType: 602, title: "坍方搶修（尚未生效）", km: 4.5, startH: 2, endH: 8 },
  { key: "expired", type: 1, subType: 101, title: "事故已排除（已到期）", km: 5.8, startH: -5, endH: -1 },
];

/** 台灣時間 ISO 字串（與 TDX 一致帶 +08:00） */
function toTaipeiIso(d: Date): string {
  return new Date(d.getTime() + 8 * 3600_000).toISOString().replace(/\.\d{3}Z$/, "+08:00");
}

/** 依里程在折線上內插座標 */
function pointAtKm(points: [number, number][], cumulativeKm: number[], km: number): [number, number] {
  const i = cumulativeKm.findIndex((k) => k >= km);
  if (i <= 0) return points[Math.max(i, 0)]!;
  const k0 = cumulativeKm[i - 1]!;
  const t = (km - k0) / (cumulativeKm[i]! - k0 || 1);
  const [lat1, lon1] = points[i - 1]!;
  const [lat2, lon2] = points[i]!;
  return [lat1 + (lat2 - lat1) * t, lon1 + (lon2 - lon1) * t];
}

/** 示意路線的假 TDX 事件；生效／到期時間相對 now，任何時候打開都看得到同一組示警 */
export function demoRoadEvents(route: Route, now: Date = new Date()): RoadEvent[] {
  const polyline = buildRoutePolylineKm(route);
  if (!polyline) return [];
  const hour = 3600_000;
  return DEMO_EVENTS.map((e) => {
    const [lat, lon] = pointAtKm(polyline.points, polyline.cumulativeKm, e.km);
    const updated = toTaipeiIso(new Date(now.getTime() + Math.min(e.startH, 0) * hour));
    return {
      id: `demo-${e.key}`,
      type: e.type,
      subType: e.subType,
      title: `${DEMO_EVENT_PREFIX}${e.title}`,
      // 路況列表優先顯示 description，同樣帶「示意」前綴
      description: `${DEMO_EVENT_PREFIX}${e.title}`,
      lat,
      lon,
      source: "示意資料",
      effectiveTime: toTaipeiIso(new Date(now.getTime() + e.startH * hour)),
      expireTime: e.endH === null ? null : toTaipeiIso(new Date(now.getTime() + e.endH * hour)),
      updatedTime: updated,
    };
  });
}

/** 示意路線的鏡頭狀態依序輪流，讓 demo 時四種狀態燈都看得到 */
const DEMO_CCTV_STATUSES: CCTVFeed["status"][] = ["online", "degraded", "offline", "unknown"];

/**
 * 示意路線的鏡頭不探測，改套示意狀態；影像本身仍是真實鏡頭
 * lastUpdated 註明「示意狀態」，避免被當成實際探測結果
 */
export function applyDemoCctvStatuses(feeds: CCTVFeed[]): CCTVFeed[] {
  return feeds.map((feed, i) => ({
    ...feed,
    status: DEMO_CCTV_STATUSES[i % DEMO_CCTV_STATUSES.length]!,
    lastUpdated: "示意狀態，非實際探測結果",
  }));
}
