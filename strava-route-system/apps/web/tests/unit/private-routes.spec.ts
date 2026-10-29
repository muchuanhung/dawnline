import { test, expect } from "@playwright/test";
import {
  BackendError,
  GPX_MAX_BYTES,
  ROUTE_NAME_MAX,
  quotaHint,
  routeNameFromFile,
  uploadErrorMessage,
  uploadProgressLabel,
  uploadProgressValue,
  validateGpxFile,
  validateRouteName,
} from "@/lib/routes/private-routes";

test.describe("validateGpxFile", () => {
  test("accepts a .gpx file within the limit", () => {
    expect(validateGpxFile({ name: "陽金公路.GPX", size: 1024 })).toBeNull();
  });

  test("rejects other extensions", () => {
    expect(validateGpxFile({ name: "route.fit", size: 1024 })).toBe("只能上傳 .gpx 檔案");
  });

  test("rejects empty files", () => {
    expect(validateGpxFile({ name: "a.gpx", size: 0 })).toBe("檔案是空的");
  });

  test("rejects files over the limit", () => {
    expect(validateGpxFile({ name: "a.gpx", size: GPX_MAX_BYTES + 1 })).toBe("檔案超過 5 MB 上限");
    expect(validateGpxFile({ name: "a.gpx", size: GPX_MAX_BYTES })).toBeNull();
  });
});

test("routeNameFromFile strips the extension", () => {
  expect(routeNameFromFile("冷水坑 + 陽金公路.gpx")).toBe("冷水坑 + 陽金公路");
  expect(routeNameFromFile("route.GPX")).toBe("route");
});

test.describe("validateRouteName", () => {
  test("accepts a normal name", () => {
    expect(validateRouteName("  陽金 晨騎 ")).toBeNull();
  });

  test("rejects blank names", () => {
    expect(validateRouteName("")).toBe("名稱不能是空白");
    expect(validateRouteName("   ")).toBe("名稱不能是空白");
  });

  test("rejects names over the limit after trimming", () => {
    expect(validateRouteName("長".repeat(ROUTE_NAME_MAX))).toBeNull();
    expect(validateRouteName(` ${"長".repeat(ROUTE_NAME_MAX)} `)).toBeNull();
    expect(validateRouteName("長".repeat(ROUTE_NAME_MAX + 1))).toBe(`名稱最多 ${ROUTE_NAME_MAX} 字`);
  });
});

test("quotaHint only speaks up at the last slot and when full", () => {
  expect(quotaHint(0, 10)).toBeNull();
  expect(quotaHint(8, 10)).toBeNull();
  expect(quotaHint(9, 10)).toBe("還能再上傳 1 條路線");
  expect(quotaHint(10, 10)).toBe("已達路線上限，請先刪除舊路線再上傳");
  expect(quotaHint(11, 10)).toBe("已達路線上限，請先刪除舊路線再上傳");
});

test("uploadProgressLabel names each stage", () => {
  expect(uploadProgressLabel({ stage: "preparing", percent: null })).toBe("準備上傳…");
  expect(uploadProgressLabel({ stage: "uploading", percent: 42 })).toBe("上傳中 42%");
  expect(uploadProgressLabel({ stage: "uploading", percent: null })).toBe("上傳中…");
  expect(uploadProgressLabel({ stage: "processing", percent: null })).toBe("解析路線中…");
});

test.describe("uploadErrorMessage", () => {
  const err = (status: number, code: string, message = "後端訊息") => new BackendError(status, code, message);

  test("maps known codes to fixed messages", () => {
    expect(uploadErrorMessage(err(409, "route_limit_reached"))).toBe("已達路線上限，請先刪除舊路線再上傳");
    expect(uploadErrorMessage(err(413, "file_too_large"))).toBe("檔案超過 5 MB 上限");
    expect(uploadErrorMessage(err(404, "upload_not_found"))).toBe("這次上傳已失效，請重新選擇檔案");
    expect(uploadErrorMessage(err(0, "network_error"))).toBe("網路連線中斷，請確認網路後再試一次");
    expect(uploadErrorMessage(err(403, "s3_upload_failed"))).toBe("檔案上傳失敗，請再試一次");
  });

  test("keeps the backend reason for invalid GPX", () => {
    expect(uploadErrorMessage(err(422, "invalid_gpx", "GPX 無法解析：不是有效的 XML"))).toBe("GPX 無法解析：不是有效的 XML");
  });

  test("falls back by status for unknown codes", () => {
    expect(uploadErrorMessage(err(401, "http_error"))).toBe("登入已過期，請重新登入後再上傳");
    // Nginx 502 回 HTML，request() 只拿得到 http_error
    expect(uploadErrorMessage(err(502, "http_error", "HTTP 502"))).toBe("伺服器暫時無法處理，請稍後再試");
    expect(uploadErrorMessage(err(400, "bad_request", "格式錯誤"))).toBe("格式錯誤");
  });

  test("non-backend errors get a generic message", () => {
    expect(uploadErrorMessage(new TypeError("Failed to fetch"))).toBe("上傳失敗，請再試一次");
    expect(uploadErrorMessage(null)).toBe("上傳失敗，請再試一次");
  });
});

test("uploadProgressValue fills the bar only when parsing", () => {
  expect(uploadProgressValue({ stage: "preparing", percent: null })).toBe(0);
  expect(uploadProgressValue({ stage: "uploading", percent: 42 })).toBe(42);
  expect(uploadProgressValue({ stage: "uploading", percent: null })).toBe(0);
  expect(uploadProgressValue({ stage: "processing", percent: null })).toBe(100);
});
