/**
 * 私人路線（使用者上傳的 GPX）：呼叫 FastAPI 後端 /api/v1/routes。
 * Next.js rewrites 把 /api/v1/* 轉到後端，rc_session cookie 因此是同站 cookie。
 *
 * 上傳流程：POST /uploads 拿 presigned POST → 瀏覽器直傳 S3 → POST /routes 完成（後端解析 GPX）。
 */

export interface PrivateRoute {
  id: string;
  name: string;
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

const API_BASE = "/api/v1/routes";

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

/** 檔名去掉副檔名當路線名稱 */
export function routeNameFromFile(fileName: string): string {
  return fileName.replace(/\.gpx$/i, "").trim();
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { credentials: "include", ...init });
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

export async function uploadGpx(file: File): Promise<PrivateRoute> {
  const upload = await postJson<{ uploadId: string; url: string; fields: Record<string, string> }>(
    "/uploads",
    { fileSize: file.size }
  );

  // S3 presigned POST：policy 欄位在前，file 必須是最後一個欄位
  const form = new FormData();
  for (const [key, value] of Object.entries(upload.fields)) form.append(key, value);
  form.append("file", file);
  const s3 = await fetch(upload.url, { method: "POST", body: form });
  if (!s3.ok) {
    // S3 回 XML；超過大小上限是 EntityTooLarge
    const text = await s3.text().catch(() => "");
    const tooLarge = text.includes("EntityTooLarge");
    throw new BackendError(s3.status, tooLarge ? "file_too_large" : "s3_upload_failed", tooLarge ? "檔案超過大小上限" : "檔案上傳失敗，請再試一次");
  }

  return postJson<PrivateRoute>("", { uploadId: upload.uploadId, name: routeNameFromFile(file.name) });
}

export function deletePrivateRoute(id: string): Promise<void> {
  return request<void>(`/${encodeURIComponent(id)}`, { method: "DELETE" });
}

/** 短效下載網址（presigned GET） */
export async function privateRouteDownloadUrl(id: string): Promise<string> {
  const { url } = await request<{ url: string }>(`/${encodeURIComponent(id)}/gpx`);
  return url;
}
