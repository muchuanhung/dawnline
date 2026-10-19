/**
 * 左滑露出操作鈕的位移計算（純函式）：位移為負值代表往左滑，0 為收合。
 * 元件只負責收集手勢，這裡決定卡片位置與放開後要打開還是收合。
 */

/** 手指位移超過這個距離才判斷是水平滑動還是上下捲動 */
export const SWIPE_SLOP_PX = 8;

/** 依滑動開始時的位置與手指水平位移算出卡片位移，限制在 [-width, 0] */
export function swipeOffset(base: number, dx: number, width: number): number {
  return Math.min(0, Math.max(-width, base + dx));
}

/** 放開時：滑過一半就打開，否則收合 */
export function settleSwipe(offset: number, width: number): boolean {
  return offset < -width / 2;
}

/** 是否已移動到足以判斷方向；回傳 null 表示還不確定 */
export function swipeDirection(dx: number, dy: number): "horizontal" | "vertical" | null {
  if (Math.abs(dx) < SWIPE_SLOP_PX && Math.abs(dy) < SWIPE_SLOP_PX) return null;
  return Math.abs(dx) > Math.abs(dy) ? "horizontal" : "vertical";
}
