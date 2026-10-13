/**
 * TDX CCTV 存入 Firestore
 * 路徑：cctv/{cctvId}
 * 含 geohash 供後續 GeoQuery（bbox 查詢）
 */

import { getFirestoreAdmin } from "@/lib/firebase/admin";
import { encodeGeohash } from "@/lib/geo/geohash";
import type { TDXCCTVItem } from "@/lib/tdx/client";

const COLLECTION = "cctv";

export type CCTVFirestoreDoc = {
  id: string;
  lat: number;
  lon: number;
  geohash: string;
  videoUrl: string;
  label: string;
  roadName?: string;
  county?: string;
  township?: string;
  authorityName?: string;
  syncedAt: number;
};

function toDoc(item: TDXCCTVItem & { _county?: string }): CCTVFirestoreDoc | null {
  const lat = item.PositionLat ?? item.Position?.PositionLat;
  const lon = item.PositionLon ?? item.Position?.PositionLon;
  if (lat == null || lon == null) return null;

  const videoUrl =
    item.VideoStreamURL ?? item.VideoUrl ?? item.VideoSrcUrl ?? item.Link?.Url ?? "";
  const id = item.CCTVID ?? item.CCTVId;
  if (!id) return null;

  const label = item.RoadName ?? (item as { Name?: string }).Name ?? (item as { CCTVName?: string }).CCTVName ?? id;
  const county = (item as { County?: string }).County ?? item._county;

  const doc: Record<string, unknown> = {
    id,
    lat,
    lon,
    geohash: encodeGeohash(lat, lon, 7),
    videoUrl,
    label: String(label),
    syncedAt: Date.now(),
  };
  if (item.RoadName != null) doc.roadName = item.RoadName;
  if (county != null) doc.county = county;
  const township = (item as { Township?: string }).Township;
  if (township != null) doc.township = township;
  const authorityName = (item as { AuthorityName?: string }).AuthorityName;
  if (authorityName != null) doc.authorityName = authorityName;
  return doc as CCTVFirestoreDoc;
}

export async function persistCCTVFirestore(items: (TDXCCTVItem & { _county?: string })[]): Promise<{
  written: number;
  skipped: number;
}> {
  const db = getFirestoreAdmin();
  const col = db.collection(COLLECTION);
  let written = 0;
  let skipped = 0;

  const batchSize = 500;
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = db.batch();
    const chunk = items.slice(i, i + batchSize);
    for (const item of chunk) {
      const doc = toDoc(item);
      if (!doc) {
        skipped++;
        continue;
      }
      batch.set(col.doc(doc.id), doc, { merge: true });
      written++;
    }
    await batch.commit();
  }
  return { written, skipped };
}

export async function getCCTVCountFirestore(): Promise<number> {
  const db = getFirestoreAdmin();
  const snap = await db.collection(COLLECTION).count().get();
  return snap.data().count ?? 0;
}

/** bbox [minLon, minLat, maxLon, maxLat]，擴展 ~500m (0.005° ≈ 555m) 後篩選，最多回傳 limit 筆 */
export async function getCCTVInBbox(
  bbox: [number, number, number, number],
  limit = 15
): Promise<CCTVFirestoreDoc[]> {
  const [minLon, minLat, maxLon, maxLat] = bbox;
  const pad = 0.005; // ~555m at Taiwan latitude
  const db = getFirestoreAdmin();
  const snap = await db.collection(COLLECTION).get();
  const all = snap.docs
    .map((d) => d.data() as CCTVFirestoreDoc)
    .filter(
      (d) =>
        d.lat != null &&
        d.lon != null &&
        d.lat >= minLat - pad &&
        d.lat <= maxLat + pad &&
        d.lon >= minLon - pad &&
        d.lon <= maxLon + pad
    );

  // 依緯度分層取樣，避免全集中單一行政區；最後依緯度排序，顯示順序與路線方向一致
  const bands = 5;
  const perBand = Math.ceil(limit / bands);
  const result: CCTVFirestoreDoc[] = [];
  for (let i = 0; i < bands; i++) {
    const bandMinLat = minLat - pad + ((maxLat - minLat + 2 * pad) * i) / bands;
    const bandMaxLat = minLat - pad + ((maxLat - minLat + 2 * pad) * (i + 1)) / bands;
    const inBand = all.filter((d) => d.lat! >= bandMinLat && d.lat! < bandMaxLat);
    result.push(...inBand.slice(0, perBand));
  }
  return result
    .slice(0, limit)
    .sort((a, b) => (a.lat ?? 0) - (b.lat ?? 0));
}
