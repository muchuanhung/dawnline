/**
 * 路線清單卡片的判讀標籤：每張卡一個等級，由清單用 API 一次算出所有公開路線。
 * 純函式，不依賴 React，可單元測試。
 *
 * 原則：未判定 ≠ 安全。清單資料超過 SNAPSHOT_MAX_AGE_MS（與詳情判讀同一個規則）後，
 * 「安全」改為未判定；已知的注意／危險保留（比什麼都不顯示有用）。
 */

import type { VerdictLevel } from "./recon-geo";
import { isSnapshotExpired } from "./snapshot";

/** 清單用 API 的一筆：等級以預設行程（現在出發、依路線類型的運動）計算 */
export interface RouteStatusEntry {
  id: string;
  level: VerdictLevel;
}

/** 卡片標籤：比 Route["status"] 多一個「未判定」 */
export type CardStatus = "safe" | "caution" | "risky" | "unknown";

/** 判定等級 → 卡片標籤；expired 時「安全」不可沿用 */
export function cardStatusOf(level: VerdictLevel, expired = false): CardStatus {
  if (level === "risky" || level === "caution") return level;
  return level === "clear" && !expired ? "safe" : "unknown";
}

/** 清單資料的卡片標籤；at 為資料取得時間（epoch ms），時間無效一律視為過期 */
export function listCardStatus(level: VerdictLevel, at: number, now: number): CardStatus {
  return cardStatusOf(level, !Number.isFinite(at) || isSnapshotExpired(at, now));
}
