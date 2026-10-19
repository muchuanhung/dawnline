/**
 * 瀏覽器端 GPX 解析，將 XML 字串轉為 Route 所需格式
 */

import { encodePolyline } from "./polyline";
import { repairSteppedElevation } from "./elevation";
import type { Route } from "./route-data";

interface Point {
  lat: number;
  lon: number;
  ele?: number;
}

/**
 * 從 GPX XML 與檔名判斷路線類型
 * 雪巴運動：檔名或 name/type 含 園區|YMS|Peaks of Taiwan|雪巴|Sherpa 等
 */
export function parseGpxType(xml: string, routeId?: string): Route["type"] {
  const typeMatch = xml.match(/<type>\s*([^<]+)\s*<\/type>/i);
  const nameMatch = xml.match(/<name>\s*([^<]+)\s*<\/name>/i);
  const descMatch = xml.match(/<desc>\s*([^<]+)\s*<\/desc>/i);
  const raw = typeMatch?.[1]?.trim().toLowerCase() ?? "";
  const name = (nameMatch?.[1] ?? "").toLowerCase();
  const desc = (descMatch?.[1] ?? "").toLowerCase();
  const combined = `${name} ${desc} ${(routeId ?? "").toLowerCase()}`;

  if (/雪巴|sherpa|園區|ymss?|peaks of taiwan|grand cycling tour/i.test(combined) || /雪巴|sherpa/i.test(raw)) {
    return "雪巴運動";
  }
  // "hiking" does not contain "hike", so it is listed on its own (backend gpx.py keeps the same rule)
  if (/trail_run|trail run|hike|hiking|walk|健行|步/i.test(raw)) return "健行";
  if (/run|跑步|jog|road run/i.test(raw)) return "跑步";
  if (/cycle|cycling|ride|bike|騎|車|騎車|road|mtb/i.test(raw)) return "自行車";
  return "自行車"; // 預設
}

export function parseGpxPoints(xml: string): { points: Point[]; name: string } {
  const points: Point[] = [];
  const ptRegex =
    /<(?:rtept|trkpt)\s+lat="([^"]+)"\s+lon="([^"]+)"[^>]*>([\s\S]*?)<\/(?:rtept|trkpt)>/gi;
  let m;
  while ((m = ptRegex.exec(xml)) !== null) {
    const lat = parseFloat(m[1] ?? "");
    const lon = parseFloat(m[2] ?? "");
    const eleMatch = (m[3] ?? "").match(/<ele>([^<]+)<\/ele>/);
    points.push({
      lat,
      lon,
      ele: eleMatch?.[1] != null ? parseFloat(eleMatch[1]) : undefined,
    });
  }
  const nameMatch = xml.match(/<name>([^<]+)<\/name>/);
  return {
    points,
    name: nameMatch?.[1] != null ? nameMatch[1].trim() : "Unknown",
  };
}

export function haversineKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/** 騎車難度分級：依距離與爬升。跑步/健行用 ratio 推估 */
function inferDifficulty(
  distanceKm: number,
  elevationGain: number,
  type: Route["type"]
): Route["difficulty"] {
  if (type === "自行車" || type === "雪巴運動") {
    if (distanceKm >= 150 && elevationGain >= 2000) return "極難";
    if (distanceKm >= 100 && elevationGain >= 1000) return "困難";
    if (distanceKm >= 50 && distanceKm < 100 && elevationGain < 1000) return "中等";
    if (distanceKm >= 20 && distanceKm <= 30 && elevationGain < 500) return "簡單";
    // 邊界：30-50km 等，依 ratio 推估
    const ratio = elevationGain / distanceKm;
    if (ratio >= 25) return "困難";
    if (ratio >= 15) return "中等";
    return "簡單";
  }
  // 跑步/健行：依 ratio
  const ratio = elevationGain / distanceKm;
  if (ratio >= 80) return "極難";
  if (ratio >= 50) return "困難";
  if (ratio >= 20) return "中等";
  if (ratio >= 8) return "簡單";
  return "簡單";
}

function estimateTime(distanceKm: number, elevationGain: number): string {
  const baseHours = distanceKm / 25;
  const climbPenalty = (elevationGain / 500) * 0.25;
  const total = baseHours + climbPenalty;
  const h = Math.floor(total);
  const m = Math.round((total - h) * 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

/** 從 name 中提取中文（若格式為 "中文 English" 或 "English 中文"） */
function extractNameZh(name: string): string {
  const zhMatch = name.match(/[\u4e00-\u9fff]+/g);
  return zhMatch?.join("") ?? name;
}

/**
 * 解析 GPX XML 字串，轉為 Route 格式
 * GPX 無 weather/CCTV，使用預設空值
 * segments 可選：若提供則使用，否則為空陣列
 */
export function parseGpxToRoute(
  xml: string,
  routeId: string,
  segments: Route["segments"] = []
): Route {
  const { points, name } = parseGpxPoints(xml);
  if (points.length < 2) {
    throw new Error("GPX 中無有效 route/track 點位");
  }

  let distanceKm = 0;
  const cumulDist: number[] = [0];
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1]!;
    const curr = points[i]!;
    const d = haversineKm(prev.lat, prev.lon, curr.lat, curr.lon);
    distanceKm += d;
    cumulDist.push(distanceKm);
  }

  const hasEle = points.some((p) => p.ele != null);
  const segs = Math.max(5, Math.floor(distanceKm / 2));
  const elevationProfile: [number, number][] = hasEle
    ? repairSteppedElevation(points.map((p, i) => [cumulDist[i] ?? 0, p.ele ?? 0]))
    : Array.from({ length: segs + 1 }, (_, i) => [(distanceKm * i) / segs, 0]);

  const elevationGain = hasEle
    ? Math.round(
        points.reduce((sum, p, i) => {
          if (i === 0) return 0;
          const diff = (p.ele ?? 0) - ((points[i - 1]?.ele) ?? 0);
          return sum + (diff > 0 ? diff : 0);
        }, 0)
      )
    : 0;

  const distance = Math.round(distanceKm * 10) / 10;
  const polyline = encodePolyline(points);
  const routeType = parseGpxType(xml, routeId);

  const lats = points.map((p) => p.lat);
  const lons = points.map((p) => p.lon);
  const bbox: [number, number, number, number] = [
    Math.min(...lons),
    Math.min(...lats),
    Math.max(...lons),
    Math.max(...lats),
  ];

  return {
    id: routeId,
    bbox,
    name,
    nameZh: extractNameZh(name),
    distance,
    elevationGain,
    type: routeType,
    difficulty: inferDifficulty(distanceKm, elevationGain, routeType),
    status: "safe",
    verdictMessage: "",
    segments,
    cctvFeeds: [],
    gpxPreviewPath: polyline,
    elevationProfile,
    estimatedTime: estimateTime(distanceKm, elevationGain),
  };
}
