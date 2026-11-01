/**
 * 頭像顯示與上傳前檢查（純函式，可單元測試）。
 * 優先順序：自己上傳的頭像（後端 /api/v1/me/avatar）→ Google 頭像 → 由呼叫端顯示姓名縮寫。
 */

/** 上傳前在瀏覽器裁成的正方形邊長（px）；顯示最大 96px，256 留給 Retina 螢幕 */
export const AVATAR_SIZE = 256;

/** 選檔時原圖的上限：手機原圖常 5–10 MB，縮圖後才上傳，所以這裡放寬 */
export const AVATAR_SOURCE_MAX_BYTES = 20 * 1024 * 1024;

/** Google 頭像經 /api/avatar 代理（lh3 直連常被擋）；其他網址原樣回傳 */
export function getProxiedAvatarUrl(photoURL: string | null | undefined): string | undefined {
  if (!photoURL) return undefined;
  if (!photoURL.includes("lh3.googleusercontent.com")) return photoURL;
  return `/api/avatar?url=${encodeURIComponent(photoURL)}`;
}

/** 實際要顯示的頭像：自己上傳的優先，沒有就用 Google 頭像 */
export function resolveAvatarUrl(
  uploadedUrl: string | null | undefined,
  photoURL: string | null | undefined
): string | undefined {
  return uploadedUrl || getProxiedAvatarUrl(photoURL);
}

/** 選檔後的檢查：回傳錯誤訊息，通過回 null */
export function validateAvatarFile(file: { type: string; size: number }): string | null {
  if (!file.type.startsWith("image/") || file.type === "image/svg+xml") return "請選擇照片（JPG、PNG、WebP、HEIC）";
  if (file.size === 0) return "檔案是空的";
  if (file.size > AVATAR_SOURCE_MAX_BYTES) return `照片超過 ${AVATAR_SOURCE_MAX_BYTES / 1024 / 1024} MB 上限`;
  return null;
}

/** 從原圖中央裁出最大的正方形（drawImage 的 sx、sy、邊長） */
export function centerSquareCrop(width: number, height: number): { sx: number; sy: number; size: number } {
  const size = Math.min(width, height);
  return { sx: Math.floor((width - size) / 2), sy: Math.floor((height - size) / 2), size };
}

/** 姓名縮寫：最多兩個字；中文名取第一個字，英文取各字首 */
export function avatarInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return Array.from(words[0]!)[0]!.toUpperCase();
  return words
    .slice(0, 2)
    .map((w) => Array.from(w)[0]!)
    .join("")
    .toUpperCase();
}
