/**
 * 離線快照：快照時間、過期判斷、過期後判定降級（未判定 ≠ 安全）
 */
import { test, expect } from "@playwright/test";
import type { ReconVerdict } from "@/lib/routes/recon-geo";
import {
  SNAPSHOT_EXPIRED_NOTE,
  SNAPSHOT_HEADER,
  SNAPSHOT_MAX_AGE_MS,
  expireVerdict,
  isSnapshotExpired,
  snapshotAgeLabel,
  snapshotAtOf,
} from "@/lib/routes/snapshot";

const NOW = Date.parse("2026-10-14T09:00:00+08:00");
const MIN = 60_000;

const headers = (value: string | null) => ({ get: (name: string) => (name === SNAPSHOT_HEADER ? value : null) });

test.describe("snapshotAtOf", () => {
  test("online response has no snapshot header", () => {
    expect(snapshotAtOf(headers(null))).toBeNull();
  });

  test("reads epoch ms from the header", () => {
    expect(snapshotAtOf(headers(String(NOW)))).toBe(NOW);
  });

  test("invalid values are not treated as snapshots", () => {
    expect(snapshotAtOf(headers(""))).toBeNull();
    expect(snapshotAtOf(headers("abc"))).toBeNull();
    expect(snapshotAtOf(headers("0"))).toBeNull();
    expect(snapshotAtOf(headers("-5"))).toBeNull();
  });
});

test.describe("isSnapshotExpired", () => {
  test("fresh within 30 minutes", () => {
    expect(isSnapshotExpired(NOW - 15 * MIN, NOW)).toBe(false);
    expect(isSnapshotExpired(NOW - SNAPSHOT_MAX_AGE_MS + 1, NOW)).toBe(false);
  });

  test("expired at exactly 30 minutes and after", () => {
    expect(isSnapshotExpired(NOW - SNAPSHOT_MAX_AGE_MS, NOW)).toBe(true);
    expect(isSnapshotExpired(NOW - 3 * 60 * MIN, NOW)).toBe(true);
  });
});

test.describe("expireVerdict", () => {
  test("clear becomes unknown, never stays safe", () => {
    const v = expireVerdict({ level: "clear", headline: "沿途無示警", note: "" });
    expect(v.level).toBe("unknown");
    expect(v.reasons).toEqual(["snapshot_expired"]);
  });

  test("risky keeps level and headline, adds a note", () => {
    const risky: ReconVerdict = { level: "risky", headline: "12.4 km 起道路封閉", note: "另有 2 項示警" };
    const v = expireVerdict(risky);
    expect(v.level).toBe("risky");
    expect(v.headline).toBe(risky.headline);
    expect(v.note).toBe(`另有 2 項示警・${SNAPSHOT_EXPIRED_NOTE}`);
  });

  test("caution with empty note gets the note alone", () => {
    const v = expireVerdict({ level: "caution", headline: "3.0 km 起降雨 60%", note: "" });
    expect(v.level).toBe("caution");
    expect(v.note).toBe(SNAPSHOT_EXPIRED_NOTE);
  });

  test("unknown stays unknown and gains the snapshot reason once", () => {
    const unknown: ReconVerdict = { level: "unknown", reasons: ["stale"], headline: "預報過期，無法確認安全", note: "" };
    const v = expireVerdict(unknown);
    expect(v.level).toBe("unknown");
    expect(v.reasons).toEqual(["stale", "snapshot_expired"]);
    expect(expireVerdict(v).reasons).toEqual(["stale", "snapshot_expired"]);
  });
});

test.describe("snapshotAgeLabel", () => {
  test("labels by minutes, hours, days", () => {
    expect(snapshotAgeLabel(NOW - 20_000, NOW)).toBe("剛剛");
    expect(snapshotAgeLabel(NOW - 15 * MIN, NOW)).toBe("15 分鐘前");
    expect(snapshotAgeLabel(NOW - 125 * MIN, NOW)).toBe("2 小時前");
    expect(snapshotAgeLabel(NOW - 49 * 60 * MIN, NOW)).toBe("2 天前");
  });

  test("clock skew in the future reads as just now", () => {
    expect(snapshotAgeLabel(NOW + 5 * MIN, NOW)).toBe("剛剛");
  });
});
