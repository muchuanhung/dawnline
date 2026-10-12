/**
 * CCTV 探測紀錄存入 Firestore
 * 路徑：cctv_status/{feedId}（feedId 與 /api/cctv/near-route 回傳的 CCTVFeed.id 相同）
 * 每台鏡頭只留最近 PROBE_HISTORY_SIZE 筆，供 classifyProbeHistory 判定狀態
 */

import { getFirestoreAdmin } from "@/lib/firebase/admin";
import type { ProbeAttempt } from "@/lib/cctv/probe-status";

const COLLECTION = "cctv_status";

export type CCTVStatusDoc = {
  id: string;
  history: ProbeAttempt[];
  updatedAt: number;
};

/** 一次讀多台鏡頭的探測紀錄；沒有紀錄的鏡頭回空陣列 */
export async function getProbeHistories(ids: string[]): Promise<Map<string, ProbeAttempt[]>> {
  const result = new Map<string, ProbeAttempt[]>();
  if (ids.length === 0) return result;
  const db = getFirestoreAdmin();
  const col = db.collection(COLLECTION);
  const snaps = await db.getAll(...ids.map((id) => col.doc(id)));
  for (const snap of snaps) {
    const data = snap.exists ? (snap.data() as CCTVStatusDoc) : undefined;
    result.set(snap.id, Array.isArray(data?.history) ? data.history : []);
  }
  return result;
}

export async function saveProbeHistories(histories: Map<string, ProbeAttempt[]>): Promise<void> {
  if (histories.size === 0) return;
  const db = getFirestoreAdmin();
  const col = db.collection(COLLECTION);
  const batch = db.batch();
  const now = Date.now();
  for (const [id, history] of histories) {
    batch.set(col.doc(id), { id, history, updatedAt: now } satisfies CCTVStatusDoc);
  }
  await batch.commit();
}
