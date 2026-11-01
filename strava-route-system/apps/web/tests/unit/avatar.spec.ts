import { test, expect } from "@playwright/test";
import {
  AVATAR_SOURCE_MAX_BYTES,
  avatarInitials,
  centerSquareCrop,
  getProxiedAvatarUrl,
  resolveAvatarUrl,
  validateAvatarFile,
} from "@/lib/avatar";
import { avatarErrorMessage, avatarProgressLabel } from "@/lib/avatar-upload";
import { BackendError } from "@/lib/routes/private-routes";

test.describe("頭像顯示順序", () => {
  const google = "https://lh3.googleusercontent.com/a/abc=s96-c";

  test("自己上傳的頭像優先於 Google 頭像", () => {
    expect(resolveAvatarUrl("/api/v1/me/avatar?v=01J", google)).toBe("/api/v1/me/avatar?v=01J");
  });

  test("沒上傳時用 Google 頭像（經代理）", () => {
    expect(resolveAvatarUrl(null, google)).toBe(getProxiedAvatarUrl(google));
    expect(resolveAvatarUrl(undefined, google)).toMatch(/^\/api\/avatar\?url=/);
  });

  test("Email 註冊、沒上傳：沒有圖，交給縮寫", () => {
    expect(resolveAvatarUrl(null, null)).toBeUndefined();
  });
});

test.describe("選照片的檢查", () => {
  test("一般照片通過", () => {
    for (const type of ["image/jpeg", "image/png", "image/webp", "image/heic"]) {
      expect(validateAvatarFile({ type, size: 3_000_000 })).toBeNull();
    }
  });

  test("非圖片與 SVG 不收", () => {
    expect(validateAvatarFile({ type: "application/pdf", size: 100 })).toContain("請選擇照片");
    expect(validateAvatarFile({ type: "image/svg+xml", size: 100 })).toContain("請選擇照片");
  });

  test("空檔與超過上限", () => {
    expect(validateAvatarFile({ type: "image/png", size: 0 })).toBe("檔案是空的");
    expect(validateAvatarFile({ type: "image/png", size: AVATAR_SOURCE_MAX_BYTES + 1 })).toContain("MB 上限");
  });
});

test.describe("中央裁正方形", () => {
  test("橫的照片裁左右", () => {
    expect(centerSquareCrop(4000, 3000)).toEqual({ sx: 500, sy: 0, size: 3000 });
  });

  test("直的照片裁上下", () => {
    expect(centerSquareCrop(1080, 1920)).toEqual({ sx: 0, sy: 420, size: 1080 });
  });

  test("正方形不裁", () => {
    expect(centerSquareCrop(256, 256)).toEqual({ sx: 0, sy: 0, size: 256 });
  });
});

test.describe("姓名縮寫", () => {
  test("中文名取第一個字、英文取字首", () => {
    expect(avatarInitials("洪木川")).toBe("洪");
    expect(avatarInitials("MuChuan Hung")).toBe("MH");
    expect(avatarInitials("rider")).toBe("R");
  });

  test("空白名稱給問號", () => {
    expect(avatarInitials("  ")).toBe("?");
  });
});

test.describe("上傳訊息", () => {
  test("進度文字", () => {
    expect(avatarProgressLabel({ stage: "preparing", percent: null })).toBe("處理照片…");
    expect(avatarProgressLabel({ stage: "uploading", percent: 40 })).toBe("上傳中 40%");
    expect(avatarProgressLabel({ stage: "processing", percent: null })).toBe("儲存中…");
  });

  test("錯誤訊息", () => {
    expect(avatarErrorMessage(new BackendError(422, "invalid_image", "頭像必須是 JPEG 圖片"))).toBe("頭像必須是 JPEG 圖片");
    expect(avatarErrorMessage(new BackendError(401, "unauthenticated", "x"))).toContain("重新登入");
    expect(avatarErrorMessage(new BackendError(0, "network_error", "x"))).toContain("網路");
    expect(avatarErrorMessage(new Error("boom"))).toBe("上傳失敗，請再試一次");
  });
});
