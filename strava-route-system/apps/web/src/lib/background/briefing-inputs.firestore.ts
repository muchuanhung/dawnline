/**
 * 判讀輸入存入 Firestore（asia-east1）
 * 路徑：briefing-inputs/{kind:key}，欄位 { json, fetchedAt }
 * Vercel 上 Next 的快取在多個執行個體之間不可靠，改用 Firestore 讓所有請求共用同一份 CWB／TDX 資料，
 * 由 Inngest 排程每 10 分鐘更新；請求時缺或過期才當場抓並寫回。
 */

import { getFirestoreAdmin } from "@/lib/firebase/admin";
import type { StoredInput } from "@/lib/dashboard/briefing-inputs";

const COLLECTION = "briefing-inputs";

/** 一次讀取多份輸入（單一 getAll 往返）；不存在的 id 不會出現在結果裡 */
export async function readBriefingInputs(ids: string[]): Promise<Map<string, StoredInput>> {
  const result = new Map<string, StoredInput>();
  if (ids.length === 0) return result;
  const col = getFirestoreAdmin().collection(COLLECTION);
  const snaps = await getFirestoreAdmin().getAll(...ids.map((id) => col.doc(id)));
  for (const snap of snaps) {
    const data = snap.data() as Partial<StoredInput> | undefined;
    if (snap.exists && typeof data?.json === "string" && typeof data.fetchedAt === "number") {
      result.set(snap.id, { json: data.json, fetchedAt: data.fetchedAt });
    }
  }
  return result;
}

/** 寫入（覆蓋）多份輸入；fetchedAt 用呼叫端抓取完成的時間 */
export async function writeBriefingInputs(entries: { id: string; data: unknown; fetchedAt: number }[]): Promise<void> {
  if (entries.length === 0) return;
  const db = getFirestoreAdmin();
  const col = db.collection(COLLECTION);
  const batch = db.batch();
  for (const { id, data, fetchedAt } of entries) {
    batch.set(col.doc(id), { json: JSON.stringify(data), fetchedAt } satisfies StoredInput);
  }
  await batch.commit();
}
