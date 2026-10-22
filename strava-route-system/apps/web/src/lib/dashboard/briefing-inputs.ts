/**
 * 判讀輸入（CWB 行政區天氣、縣市雨量站、縣市 TDX 事件）的存放規則；純函式，可單元測試。
 * 讀寫 Firestore 在 lib/background/briefing-inputs.firestore.ts。
 */

/** 超過這個時間的輸入不再採用、當場重抓（排程每 10 分鐘更新，多留 5 分鐘緩衝） */
export const INPUT_MAX_AGE_MS = 15 * 60 * 1000;

export type InputKind = "weather" | "rain" | "tdx";

/** 文件 id：weather 的 key 是 districtKey（縣市|行政區），rain、tdx 是縣市名 */
export const inputId = (kind: InputKind, key: string) => `${kind}:${key}`;

/** Firestore 裡的一筆輸入；資料存成 JSON 字串（Firestore 不接受巢狀陣列與 undefined） */
export interface StoredInput {
  json: string;
  fetchedAt: number;
}

/**
 * 從已讀到的文件挑出可用的輸入：抓取時間在 maxAgeMs 內且 JSON 可解析。
 * 其餘（沒有、過期、壞掉）列在 missing，呼叫端要當場重抓；不可把它們當成「沒有資料＝安全」。
 */
export function freshInputs(
  stored: ReadonlyMap<string, StoredInput>,
  ids: readonly string[],
  now: number,
  maxAgeMs = INPUT_MAX_AGE_MS
): { fresh: Map<string, unknown>; missing: string[] } {
  const fresh = new Map<string, unknown>();
  const missing: string[] = [];
  for (const id of ids) {
    const doc = stored.get(id);
    const age = doc ? now - doc.fetchedAt : Infinity;
    // fetchedAt 在未來（時鐘誤差過大）也不信任
    if (!doc || !(age >= -60_000 && age <= maxAgeMs)) {
      missing.push(id);
      continue;
    }
    try {
      fresh.set(id, JSON.parse(doc.json));
    } catch {
      missing.push(id);
    }
  }
  return { fresh, missing };
}
