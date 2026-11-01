import { test, expect } from "@playwright/test";
import { BackendError } from "@/lib/routes/private-routes";
import {
  SLUG_MAX,
  adminErrorMessage,
  publishResultMessage,
  slugFromFile,
  validateSlug,
} from "@/lib/routes/admin-public-routes";

test.describe("slugFromFile", () => {
  test("drops .gpx like the EC2 import script", () => {
    expect(slugFromFile("陽金公路 (北段)+.GPX")).toBe("陽金公路 (北段)+");
  });
});

test.describe("validateSlug (mirrors backend SLUG_PATTERN)", () => {
  test("accepts original Firebase-style file names", () => {
    expect(validateSlug("wuling")).toBeNull();
    expect(validateSlug("武嶺 [經典] + 合歡山")).toBeNull();
    expect(validateSlug("  trimmed  ")).toBeNull();
  });

  test("rejects empty, too long and URL-reserved characters", () => {
    expect(validateSlug("   ")).toBe("網址 id 不能是空白");
    expect(validateSlug("a".repeat(SLUG_MAX))).toBeNull();
    expect(validateSlug("a".repeat(SLUG_MAX + 1))).toContain("最多");
    for (const bad of ["a/b", "a\\b", "a?b", "a#b", "100%", "a\tb"]) {
      expect(validateSlug(bad), bad).toContain("不能有");
    }
  });

  test("counts characters, not UTF-16 units", () => {
    expect(validateSlug("𠮷".repeat(SLUG_MAX))).toBeNull();
  });
});

test.describe("publishResultMessage", () => {
  const route = { id: "yangjin", name: "陽金公路" };
  test("one line per action", () => {
    expect(publishResultMessage({ action: "created", route })).toBe("已新增「陽金公路」");
    expect(publishResultMessage({ action: "updated", route })).toBe("已更新「陽金公路」");
    expect(publishResultMessage({ action: "unchanged", route })).toContain("沒有變更");
  });
});

test.describe("adminErrorMessage", () => {
  test("403 and admin-specific codes", () => {
    expect(adminErrorMessage(new BackendError(403, "forbidden", "x"))).toBe("只有管理員可以操作");
    expect(adminErrorMessage(new BackendError(422, "invalid_slug", "網址 id 不合法"))).toBe("網址 id 不合法");
  });
  test("falls back to upload messages", () => {
    expect(adminErrorMessage(new BackendError(0, "network_error", "x"))).toContain("網路");
  });
});
