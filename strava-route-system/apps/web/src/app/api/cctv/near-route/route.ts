/**
 * 依路線 bbox 查詢附近 CCTV（Firestore 篩選）
 * GET /api/cctv/near-route?minLon=&minLat=&maxLon=&maxLat=
 *
 * 靜態補充：TDX 未涵蓋的國家公園景點（如陽明山冷水坑、小油坑等）
 */

import { NextResponse } from "next/server";
import { getCCTVInBbox } from "@/lib/background/tdx-cctv.firestore";
import { getStaticCCTVInBbox } from "@/lib/cctv/static-supplement";
import { findTownshipDetailByLngLat } from "@/lib/maps/taiwan-towns-topojson";
import type { CCTVFeed } from "@/lib/routes/route-data";

function toCCTVFeed(doc: { id: string; label: string; roadName?: string; county?: string; lat?: number; lon?: number; videoUrl: string; syncedAt: number }): CCTVFeed {
  const seed = doc.id.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  const township =
    doc.lat != null && doc.lon != null
      ? findTownshipDetailByLngLat(doc.lon, doc.lat)?.town
      : undefined;
  const base = doc.roadName ?? doc.county ?? doc.label;
  const location = township ? `${base} (${township})` : base;
  return {
    id: doc.id,
    label: doc.label,
    location,
    lat: doc.lat,
    lon: doc.lon,
    township,
    // 這是每日鏡頭清單的同步時間，不是影像時間
    lastUpdated: `鏡頭清單同步於 ${new Date(doc.syncedAt).toLocaleString("zh-TW", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}`,
    imageSeed: seed,
    videoUrl: doc.videoUrl || undefined,
  };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const minLon = parseFloat(searchParams.get("minLon") ?? "");
  const minLat = parseFloat(searchParams.get("minLat") ?? "");
  const maxLon = parseFloat(searchParams.get("maxLon") ?? "");
  const maxLat = parseFloat(searchParams.get("maxLat") ?? "");

  if (Number.isNaN(minLon) || Number.isNaN(minLat) || Number.isNaN(maxLon) || Number.isNaN(maxLat)) {
    return NextResponse.json({ error: "缺少 bbox 參數：minLon, minLat, maxLon, maxLat" }, { status: 400 });
  }

  try {
    const bbox: [number, number, number, number] = [minLon, minLat, maxLon, maxLat];
    const [tdxDocs, staticFeeds] = await Promise.all([
      getCCTVInBbox(bbox, 30),
      Promise.resolve(getStaticCCTVInBbox(bbox)),
    ]);
    const tdxFeeds = tdxDocs.map(toCCTVFeed);
    const merged = [...staticFeeds, ...tdxFeeds];
    return NextResponse.json(merged);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
