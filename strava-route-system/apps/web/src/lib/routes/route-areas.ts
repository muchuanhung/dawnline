/**
 * 路線經過的縣市與行政區：依路段順序（即沿路線里程）列出，重複經過的只列第一次。
 * 純函式，不依賴 React 與伺服器；路線頁與今日判讀共用。
 */

import type { RouteSegment } from "@/lib/routes/route-data";

export interface RouteArea {
  county: string;
  districts: string[];
}

/** 依第一次經過的順序，把行政區歸到所屬縣市；沒有縣市或行政區的路段略過 */
export function routeAreas(segments: readonly Pick<RouteSegment, "county" | "districtZh">[]): RouteArea[] {
  const areas: RouteArea[] = [];
  for (const seg of segments) {
    if (!seg.county || !seg.districtZh) continue;
    let area = areas.find((a) => a.county === seg.county);
    if (!area) {
      area = { county: seg.county, districts: [] };
      areas.push(area);
    }
    if (!area.districts.includes(seg.districtZh)) area.districts.push(seg.districtZh);
  }
  return areas;
}

/** 顯示用：只列縣市，「臺北市、新北市」（行政區列出來太長）；沒有資料回空字串 */
export function formatRouteAreas(areas: readonly RouteArea[]): string {
  return areas.map((a) => a.county).join("、");
}
