/**
 * 途中模式持續定位：重新判讀節流
 */
import { test, expect } from "@playwright/test";
import { RIDE_REBRIEF_MAX_AGE_MS, shouldRebrief } from "@/lib/routes/ride-position";

const NOW = Date.parse("2026-10-01T09:00:00+08:00");
const MIN = 60_000;

test.describe("shouldRebrief", () => {
  test("first fix always re-briefs", () => {
    expect(shouldRebrief(null, 3.2, NOW)).toBe(true);
  });

  test("GPS jitter under 0.5 km within 5 minutes does not re-brief", () => {
    expect(shouldRebrief({ km: 3.2, at: NOW - MIN }, 3.6, NOW)).toBe(false);
    expect(shouldRebrief({ km: 3.2, at: NOW - MIN }, 2.8, NOW)).toBe(false);
  });

  test("moving 0.5 km or more re-briefs, either direction", () => {
    expect(shouldRebrief({ km: 3.2, at: NOW - MIN }, 3.7, NOW)).toBe(true);
    expect(shouldRebrief({ km: 3.2, at: NOW - MIN }, 2.7, NOW)).toBe(true);
  });

  test("5 minutes since last brief re-briefs even when standing still", () => {
    expect(shouldRebrief({ km: 3.2, at: NOW - RIDE_REBRIEF_MAX_AGE_MS + 1 }, 3.2, NOW)).toBe(false);
    expect(shouldRebrief({ km: 3.2, at: NOW - RIDE_REBRIEF_MAX_AGE_MS }, 3.2, NOW)).toBe(true);
  });
});
