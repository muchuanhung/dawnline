/**
 * 靜態補充 CCTV：TDX 未涵蓋的景點監視器（國家公園、風景區等）
 * 來源：tw.live 即時影像監視器
 * @see https://tw.live/
 */

import type { CCTVFeed } from "@/lib/routes/route-data";

export type StaticCCTVItem = {
  id: string;
  label: string;
  lat: number;
  lon: number;
  videoUrl: string;
  location: string;
  township?: string;
};

/**
 * 陽明山國家公園等 TDX 未涵蓋的重要景點 CCTV（tw.live）
 * 陽明山國家公園管理處來源
 */
const STATIC_CCTV: StaticCCTVItem[] = [
  {
    id: "lsktcc",
    label: "冷水坑停車場",
    lat: 25.1667,
    lon: 121.5583,
    videoUrl: "https://tw.live/cam/?id=lsktcc",
    location: "冷水坑停車場 (陽明山)",
    township: "北投區",
  },
  {
    id: "bot236",
    label: "故宮路-至善路口",
    lat: 25.101834,
    lon: 121.548775,
    videoUrl: "https://hls.bote.gov.taipei/live/index.html?id=236",
    location: "故宮路-至善路口 (士林區)",
    township: "士林區",
  },
  {
    id: "ezptcc",
    label: "二子坪停車場",
    lat: 25.1786,
    lon: 121.5222,
    videoUrl: "https://tw.live/cam/?id=ezptcc",
    location: "二子坪停車場 (陽明山)",
    township: "北投區",
  },
  {
    id: "xyktcc",
    label: "小油坑停車場",
    lat: 25.1815,
    lon: 121.5485,
    videoUrl: "https://tw.live/cam/?id=xyktcc",
    location: "小油坑停車場 (陽明山)",
    township: "北投區",
  },
];

function toCCTVFeed(item: StaticCCTVItem): CCTVFeed {
  const seed = item.id.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  return {
    id: `static-${item.id}`,
    label: item.label,
    location: item.location,
    lat: item.lat,
    lon: item.lon,
    township: item.township,
    lastUpdated: "手動維護的鏡頭清單",
    imageSeed: seed,
    // 沒有探測過鏡頭是否在線，不可標成直播
    status: "unknown",
    videoUrl: item.videoUrl,
  };
}

/** 檢查 bbox 是否與靜態 CCTV 重疊（含 padding） */
function bboxOverlaps(
  bbox: [number, number, number, number],
  lat: number,
  lon: number,
  pad = 0.01
): boolean {
  const [minLon, minLat, maxLon, maxLat] = bbox;
  return (
    lat >= minLat - pad &&
    lat <= maxLat + pad &&
    lon >= minLon - pad &&
    lon <= maxLon + pad
  );
}

/**
 * 依 bbox 取得靜態補充 CCTV（陽明山等 TDX 未涵蓋景點）
 */
export function getStaticCCTVInBbox(
  bbox: [number, number, number, number]
): CCTVFeed[] {
  const pad = 0.015; // ~1.5km
  return STATIC_CCTV.filter((c) => bboxOverlaps(bbox, c.lat, c.lon, pad)).map(
    toCCTVFeed
  );
}
