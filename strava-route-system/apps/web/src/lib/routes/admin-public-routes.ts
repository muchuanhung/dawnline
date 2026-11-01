/**
 * 管理員在網站上新增／下架公開路線：呼叫 FastAPI /api/v1/admin/public-routes（非管理員後端回 403）。
 * 上傳流程與私人路線相同（presigned POST → 直傳 S3 → 完成），差別是完成時送 slug（公開路線的網址 id），
 * 同 slug 會覆寫既有路線，收藏與網址保留。成功後清 Next 的公開路線快取，清單馬上更新。
 */

import {
  BackendError,
  request,
  routeNameFromFile,
  sendGpxToS3,
  uploadErrorMessage,
  type UploadProgress,
} from "@/lib/routes/private-routes";

const API_BASE = "/api/v1/admin/public-routes";

/** 與後端 public_route_service.SLUG_PATTERN 相同：1–64 字，頭尾不能是空白，不能有 / \ ? # % 與控制字元 */
export const SLUG_MAX = 64;
// eslint-disable-next-line no-control-regex
const FORBIDDEN_SLUG_CHARS = /[/\\?#%\u0000-\u001f]/;

export type PublishAction = "created" | "updated" | "unchanged";

export interface PublishResult {
  action: PublishAction;
  route: { id: string; name: string };
}

/** 預設 slug：檔名去掉 .gpx（與 EC2 匯入腳本相同規則） */
export function slugFromFile(fileName: string): string {
  return routeNameFromFile(fileName);
}

/** 網址 id 檢查：回傳錯誤訊息，通過回 null（後端會再檢查一次） */
export function validateSlug(slug: string): string | null {
  const trimmed = slug.trim();
  if (!trimmed) return "網址 id 不能是空白";
  if ([...trimmed].length > SLUG_MAX) return `網址 id 最多 ${SLUG_MAX} 字`;
  if (FORBIDDEN_SLUG_CHARS.test(trimmed)) return "網址 id 不能有 / \\ ? # %";
  return null;
}

/** 完成後給管理員看的一句話 */
export function publishResultMessage(result: PublishResult): string {
  switch (result.action) {
    case "created":
      return `已新增「${result.route.name}」`;
    case "updated":
      return `已更新「${result.route.name}」`;
    case "unchanged":
      return `「${result.route.name}」內容相同，沒有變更`;
  }
}

export function adminErrorMessage(err: unknown): string {
  if (err instanceof BackendError) {
    if (err.status === 403) return "只有管理員可以操作";
    if (err.code === "invalid_slug" || err.code === "route_not_found") return err.message;
  }
  return uploadErrorMessage(err);
}

export async function publishPublicRoute(
  file: File,
  slug: string,
  onProgress: (progress: UploadProgress) => void = () => {}
): Promise<PublishResult> {
  onProgress({ stage: "preparing", percent: null });
  const upload = await request<{ uploadId: string; url: string; fields: Record<string, string> }>(
    "/uploads",
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fileSize: file.size }) },
    API_BASE
  );
  await sendGpxToS3(upload, file, onProgress);
  onProgress({ stage: "processing", percent: null });
  const result = await request<PublishResult>(
    "",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uploadId: upload.uploadId, slug: slug.trim() }),
    },
    API_BASE
  );
  await refreshPublicRoutesCache();
  return result;
}

export async function unpublishPublicRoute(slug: string): Promise<void> {
  await request<void>(`/${encodeURIComponent(slug)}`, { method: "DELETE" }, API_BASE);
  await refreshPublicRoutesCache();
}

/** 清 Next 伺服器端的公開路線快取（10 分鐘）；失敗只是晚一點才看到，不算操作失敗 */
async function refreshPublicRoutesCache(): Promise<void> {
  await fetch("/api/routes/revalidate", { method: "POST", credentials: "include" }).catch(() => undefined);
}
