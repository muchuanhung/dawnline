/**
 * 自訂頭像上傳（瀏覽器端）：裁成 256px 正方形 JPEG → POST /api/v1/me/avatar/uploads 拿 presigned POST
 * → 直傳 S3（XHR 回報百分比）→ PUT /api/v1/me/avatar 確認。流程與 GPX 上傳相同，共用 request／postFormWithProgress。
 */

import { AVATAR_SIZE, centerSquareCrop } from "@/lib/avatar";
import { BackendError, postFormWithProgress, request, type UploadProgress } from "@/lib/routes/private-routes";

const API_BASE = "/api/v1/me";
const JPEG_QUALITY = 0.86;

interface MeResponse {
  avatarUrl: string | null;
}

/** 讀原圖、中央裁正方形、縮到 AVATAR_SIZE，輸出 JPEG（同時去掉 EXIF 等中繼資料，包含 GPS） */
export async function resizeToJpeg(file: Blob): Promise<Blob> {
  let bitmap: ImageBitmap;
  try {
    // imageOrientation: from-image 讓手機直拍的照片轉正
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new BackendError(0, "unreadable_image", "無法讀取這張照片，請換一張試試");
  }
  const { sx, sy, size } = centerSquareCrop(bitmap.width, bitmap.height);
  const out = Math.min(AVATAR_SIZE, size);
  const canvas = document.createElement("canvas");
  canvas.width = out;
  canvas.height = out;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new BackendError(0, "unreadable_image", "瀏覽器不支援圖片處理");
  // JPEG 沒有透明：先鋪白底，PNG 透明處才不會變黑
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, out, out);
  ctx.drawImage(bitmap, sx, sy, size, size, 0, 0, out, out);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY));
  if (!blob) throw new BackendError(0, "unreadable_image", "無法處理這張照片，請換一張試試");
  return blob;
}

/** 上傳頭像，回傳新的頭像網址；onProgress 的 processing 階段代表後端確認中 */
export async function uploadAvatar(
  file: Blob,
  onProgress: (progress: UploadProgress) => void = () => {}
): Promise<string | null> {
  onProgress({ stage: "preparing", percent: null });
  const jpeg = await resizeToJpeg(file);
  const upload = await request<{ uploadId: string; url: string; fields: Record<string, string> }>(
    "/avatar/uploads",
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fileSize: jpeg.size }) },
    API_BASE
  );

  // S3 presigned POST：policy 欄位在前，file 必須是最後一個欄位
  const form = new FormData();
  for (const [key, value] of Object.entries(upload.fields)) form.append(key, value);
  form.append("file", jpeg, "avatar.jpg");
  onProgress({ stage: "uploading", percent: 0 });
  const s3 = await postFormWithProgress(upload.url, form, (percent) => onProgress({ stage: "uploading", percent }));
  if (s3.status < 200 || s3.status >= 300) {
    throw new BackendError(s3.status, "s3_upload_failed", "照片上傳失敗，請再試一次");
  }

  onProgress({ stage: "processing", percent: null });
  const me = await request<MeResponse>(
    "/avatar",
    { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ uploadId: upload.uploadId }) },
    API_BASE
  );
  return me.avatarUrl;
}

export function deleteAvatar(): Promise<void> {
  return request<void>("/avatar", { method: "DELETE" }, API_BASE);
}

/** 頭像上傳錯誤轉成使用者看得懂的訊息 */
export function avatarErrorMessage(err: unknown): string {
  if (!(err instanceof BackendError)) return "上傳失敗，請再試一次";
  switch (err.code) {
    case "unreadable_image":
    case "invalid_image":
    case "s3_upload_failed":
      return err.message;
    case "network_error":
      return "網路連線中斷，請確認網路後再試一次";
  }
  if (err.status === 401) return "登入已過期，請重新登入後再試";
  if (err.status >= 500) return "伺服器暫時無法處理，請稍後再試";
  return err.message || "上傳失敗，請再試一次";
}

/** 進度條下的文字 */
export function avatarProgressLabel(progress: UploadProgress): string {
  switch (progress.stage) {
    case "preparing":
      return "處理照片…";
    case "uploading":
      return progress.percent == null ? "上傳中…" : `上傳中 ${progress.percent}%`;
    case "processing":
      return "儲存中…";
  }
}
