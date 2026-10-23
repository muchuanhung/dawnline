/**
 * 路線清單卡片標籤：等級轉標籤、過期後「安全」不可沿用（未判定 ≠ 安全）
 */
import { test, expect } from "@playwright/test";
import { cardStatusOf, listCardStatus } from "@/lib/routes/route-statuses";
import { SNAPSHOT_MAX_AGE_MS } from "@/lib/routes/snapshot";

const NOW = Date.parse("2026-10-23T13:00:00+08:00");

test.describe("cardStatusOf", () => {
  test("levels map to card statuses", () => {
    expect(cardStatusOf("clear")).toBe("safe");
    expect(cardStatusOf("caution")).toBe("caution");
    expect(cardStatusOf("risky")).toBe("risky");
    expect(cardStatusOf("unknown")).toBe("unknown");
  });

  test("expired clear is unknown, never safe", () => {
    expect(cardStatusOf("clear", true)).toBe("unknown");
  });

  test("expired warnings keep their level", () => {
    expect(cardStatusOf("risky", true)).toBe("risky");
    expect(cardStatusOf("caution", true)).toBe("caution");
  });
});

test.describe("listCardStatus", () => {
  test("fresh data keeps safe", () => {
    expect(listCardStatus("clear", NOW - SNAPSHOT_MAX_AGE_MS + 1, NOW)).toBe("safe");
  });

  test("data at exactly the max age is expired", () => {
    expect(listCardStatus("clear", NOW - SNAPSHOT_MAX_AGE_MS, NOW)).toBe("unknown");
  });

  test("invalid timestamp counts as expired", () => {
    expect(listCardStatus("clear", Number.NaN, NOW)).toBe("unknown");
    expect(listCardStatus("risky", Number.NaN, NOW)).toBe("risky");
  });
});
