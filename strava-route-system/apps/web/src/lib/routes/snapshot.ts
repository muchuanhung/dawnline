/**
 * 離線快照的純函式：讀快照時間、過期判斷、過期後的判定降級
 * 不依賴 React 與瀏覽器 API，可單元測試。
 *
 * 快照由 public/sw.js 寫入 Cache API；網路失敗時 SW 回傳快取，並帶 SNAPSHOT_HEADER（存檔時間，epoch ms）。
 * 原則：未判定 ≠ 安全。快照超過 SNAPSHOT_MAX_AGE_MS 後「安全」一律改為未判定；
 * 已知的注意／危險示警保留等級（比什麼都不顯示有用），但加註可能已變化。
 */

import type { ReconVerdict } from "./recon-geo";

/** SW 回傳快取時加上的標頭，值為存檔時間（epoch ms）；與 public/sw.js 的 SNAPSHOT_HEADER 必須一致 */
export const SNAPSHOT_HEADER = "x-dawnline-snapshot-at";

/** 快照有效時間：即時雨量 10 分鐘更新、路況事件隨時會變，超過 30 分鐘「沒有示警」不再代表安全 */
export const SNAPSHOT_MAX_AGE_MS = 30 * 60_000;

/** 過期後已知示警的加註 */
export const SNAPSHOT_EXPIRED_NOTE = "離線資料可能已變化";

/** 回應標頭中的快照時間；不是快照（線上取得）或值無效時回傳 null */
export function snapshotAtOf(headers: { get(name: string): string | null }): number | null {
  const raw = headers.get(SNAPSHOT_HEADER);
  if (raw == null || raw === "") return null;
  const at = Number(raw);
  return Number.isFinite(at) && at > 0 ? at : null;
}

/** 快照是否已過期；剛好 30 分鐘算過期 */
export function isSnapshotExpired(savedAt: number, now: number): boolean {
  return now - savedAt >= SNAPSHOT_MAX_AGE_MS;
}

/**
 * 過期快照的顯示用判定：
 * - clear → unknown（原因 snapshot_expired），不可沿用「安全」
 * - risky／caution → 保留等級與標題，note 加註可能已變化
 * - unknown → 補上 snapshot_expired 原因，其餘不變
 */
export function expireVerdict(verdict: ReconVerdict): ReconVerdict {
  switch (verdict.level) {
    case "clear":
      return {
        level: "unknown",
        reasons: ["snapshot_expired"],
        headline: "離線資料過期，無法確認安全",
        note: "收不到訊號，判讀超過 30 分鐘沒有更新，不代表安全。",
      };
    case "risky":
    case "caution":
      return { ...verdict, note: joinNote(verdict.note, SNAPSHOT_EXPIRED_NOTE) };
    case "unknown": {
      const reasons = verdict.reasons ?? [];
      return reasons.includes("snapshot_expired") ? verdict : { ...verdict, reasons: [...reasons, "snapshot_expired"] };
    }
  }
}

/** 快照年齡的短標籤，例：「剛剛」「15 分鐘前」「2 小時前」 */
export function snapshotAgeLabel(savedAt: number, now: number): string {
  const min = Math.max(0, Math.floor((now - savedAt) / 60_000));
  if (min < 1) return "剛剛";
  if (min < 60) return `${min} 分鐘前`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours} 小時前`;
  return `${Math.floor(hours / 24)} 天前`;
}

const joinNote = (note: string, extra: string) => (note ? `${note}・${extra}` : extra);
