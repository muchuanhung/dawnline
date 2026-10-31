/**
 * 私人路線（使用者上傳的 GPX）：呼叫 FastAPI 後端 /api/v1/routes。
 * Next.js rewrites 把 /api/v1/* 轉到後端，rc_session cookie 因此是同站 cookie。
 *
 * 上傳流程：POST /uploads 拿 presigned POST → 瀏覽器直傳 S3 → POST /routes 完成（後端解析 GPX）。
 * 三個步驟對應 UploadStage，S3 那段用 XHR 回報上傳百分比（fetch 拿不到上傳進度）。
 */

import type { Route } from "@/lib/routes/route-data";

export interface PrivateRoute {
  id: string;
  name: string;
  /** 自行車／跑步／健行／雪巴運動，後端依 GPX 判斷（規則同 parse-gpx.ts） */
  type: string;
  status: "processing" | "ready" | "failed";
  distanceKm: number | null;
  elevationGainM: number | null;
  fileSize: number;
  createdAt: string;
}

export interface PrivateRouteList {
  routes: PrivateRoute[];
  limit: number;
}

/** 與後端 GPX_MAX_BYTES 預設一致；送出前先擋，伺服器端仍會再檢查 */
export const GPX_MAX_BYTES = 5 * 1024 * 1024;

/** 與後端 route_service.NAME_MAX 一致 */
export const ROUTE_NAME_MAX = 100;

const API_BASE = "/api/v1/routes";

/** preparing：檢查額度並拿上傳網址；uploading：傳檔到 S3；processing：後端解析 GPX */
export type UploadStage = "preparing" | "uploading" | "processing";

export interface UploadProgress {
  stage: UploadStage;
  /** 0–100；只有 uploading 有值 */
  percent: number | null;
}

/** 後端錯誤；status 401 代表後端 session 過期，呼叫端可重新換 session 後再試 */
export class BackendError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message);
  }
}

/** 送出前的檔案檢查：回傳錯誤訊息，通過回 null */
export function validateGpxFile(file: { name: string; size: number }, maxBytes = GPX_MAX_BYTES): string | null {
  if (!/\.gpx$/i.test(file.name)) return "只能上傳 .gpx 檔案";
  if (file.size === 0) return "檔案是空的";
  if (file.size > maxBytes) return `檔案超過 ${Math.round(maxBytes / 1024 / 1024)} MB 上限`;
  return null;
}

/** 改名前的檢查：回傳錯誤訊息，通過回 null（後端會再 trim 與截斷） */
export function validateRouteName(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return "名稱不能是空白";
  if (trimmed.length > ROUTE_NAME_MAX) return `名稱最多 ${ROUTE_NAME_MAX} 字`;
  return null;
}

/** 上傳按鈕與面板上的進度文字 */
export function uploadProgressLabel(progress: UploadProgress): string {
  switch (progress.stage) {
    case "preparing":
      return "準備上傳…";
    case "uploading":
      return progress.percent == null ? "上傳中…" : `上傳中 ${progress.percent}%`;
    case "processing":
      return "解析路線中…";
  }
}

/** 進度條的值（0–100）：準備沒有百分比顯示 0、解析顯示滿格，搭配文字說明目前步驟 */
export function uploadProgressValue(progress: UploadProgress): number {
  if (progress.stage === "processing") return 100;
  return progress.percent ?? 0;
}

/** 額度提示：還剩 1 條或已滿時才回傳文字，其他情況回 null */
export function quotaHint(used: number, limit: number): string | null {
  if (used >= limit) return "已達路線上限，請先刪除舊路線再上傳";
  if (limit - used === 1) return "還能再上傳 1 條路線";
  return null;
}

/**
 * 上傳錯誤轉成使用者看得懂的訊息。
 * 後端已有中文訊息的錯誤碼沿用後端訊息；網路錯誤、5xx 與 Nginx 回的非 JSON 錯誤改成固定說明。
 */
export function uploadErrorMessage(err: unknown): string {
  if (!(err instanceof BackendError)) return "上傳失敗，請再試一次";
  switch (err.code) {
    case "route_limit_reached":
      return "已達路線上限，請先刪除舊路線再上傳";
    case "file_too_large":
      return `檔案超過 ${Math.round(GPX_MAX_BYTES / 1024 / 1024)} MB 上限`;
    case "invalid_gpx":
      // 後端訊息已含原因（例如「GPX 無法解析：GPX 中無有效 route/track 點位」）
      return err.message;
    case "upload_not_found":
    case "upload_already_completed":
      return "這次上傳已失效，請重新選擇檔案";
    case "network_error":
      return "網路連線中斷，請確認網路後再試一次";
    case "s3_upload_failed":
      return "檔案上傳失敗，請再試一次";
  }
  if (err.status === 401) return "登入已過期，請重新登入後再上傳";
  if (err.status >= 500) return "伺服器暫時無法處理，請稍後再試";
  return err.message || "上傳失敗，請再試一次";
}

/** 檔名去掉副檔名當路線名稱 */
export function routeNameFromFile(fileName: string): string {
  return fileName.replace(/\.gpx$/i, "").trim();
}

/** 呼叫後端（經 Vercel rewrite 的 /api/v1/*）；base 預設私人路線，收藏等其他資源傳自己的 base */
export async function request<T>(path: string, init?: RequestInit, base: string = API_BASE): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, { credentials: "include", ...init });
  } catch {
    throw new BackendError(0, "network_error", "網路連線中斷");
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = data?.error;
    throw new BackendError(res.status, err?.code ?? "http_error", err?.message ?? `HTTP ${res.status}`);
  }
  return data as T;
}

function postJson<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function listPrivateRoutes(): Promise<PrivateRouteList> {
  return request<PrivateRouteList>("");
}

/** multipart POST 到 S3 並回報上傳百分比；網路中斷丟 network_error */
function postFormWithProgress(
  url: string,
  form: FormData,
  onPercent: (percent: number) => void
): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) onPercent(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => resolve({ status: xhr.status, text: xhr.responseText });
    xhr.onerror = () => reject(new BackendError(0, "network_error", "網路連線中斷"));
    xhr.ontimeout = xhr.onerror;
    xhr.send(form);
  });
}

export async function uploadGpx(
  file: File,
  onProgress: (progress: UploadProgress) => void = () => {}
): Promise<PrivateRoute> {
  onProgress({ stage: "preparing", percent: null });
  const upload = await postJson<{ uploadId: string; url: string; fields: Record<string, string> }>(
    "/uploads",
    { fileSize: file.size }
  );

  // S3 presigned POST：policy 欄位在前，file 必須是最後一個欄位
  const form = new FormData();
  for (const [key, value] of Object.entries(upload.fields)) form.append(key, value);
  form.append("file", file);
  onProgress({ stage: "uploading", percent: 0 });
  const s3 = await postFormWithProgress(upload.url, form, (percent) => onProgress({ stage: "uploading", percent }));
  if (s3.status < 200 || s3.status >= 300) {
    // S3 回 XML；超過大小上限是 EntityTooLarge
    const tooLarge = s3.text.includes("EntityTooLarge");
    throw new BackendError(s3.status, tooLarge ? "file_too_large" : "s3_upload_failed", tooLarge ? "檔案超過大小上限" : "檔案上傳失敗，請再試一次");
  }

  onProgress({ stage: "processing", percent: null });
  return postJson<PrivateRoute>("", { uploadId: upload.uploadId, name: routeNameFromFile(file.name) });
}

/** 改名：只改後端 DB 的名稱，id 與檔案不變 */
export function renamePrivateRoute(id: string, name: string): Promise<PrivateRoute> {
  return request<PrivateRoute>(`/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: name.trim() }),
  });
}

export function deletePrivateRoute(id: string): Promise<void> {
  return request<void>(`/${encodeURIComponent(id)}`, { method: "DELETE" });
}

/** 短效下載網址（presigned GET） */
export async function privateRouteDownloadUrl(id: string): Promise<string> {
  const { url } = await request<{ url: string }>(`/${encodeURIComponent(id)}/gpx`);
  return url;
}

/**
 * 私人路線詳情：Next.js 伺服器端讀 GPX 並解析成 Route（/api/routes/private），
 * 401 時同樣丟 BackendError，呼叫端可重換 session 後重試。
 */
export async function fetchPrivateRouteDetail(id: string): Promise<Route> {
  const res = await fetch(`/api/routes/private?route=${encodeURIComponent(id)}`, { credentials: "include" });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new BackendError(res.status, "http_error", data?.error ?? `HTTP ${res.status}`);
  return data as Route;
}
