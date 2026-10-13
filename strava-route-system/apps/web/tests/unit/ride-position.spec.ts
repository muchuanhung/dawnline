/**
 * 途中模式持續定位：重新判讀節流、記住的里程解析
 */
import { test, expect } from "@playwright/test";
import {
  parseRememberedKm,
  RIDE_REBRIEF_MAX_AGE_MS,
  RIDE_REMEMBER_TTL_MS,
  shouldRebrief,
} from "@/lib/routes/ride-position";

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

test.describe("parseRememberedKm", () => {
  const raw = (v: unknown) => JSON.stringify(v);

  test("recent km within the route is restored", () => {
    expect(parseRememberedKm(raw({ km: 4.5, at: NOW - 30 * MIN }), NOW, 12)).toEqual({ km: 4.5, at: NOW - 30 * MIN });
  });

  test("expired, future-dated or out-of-route km is not restored", () => {
    expect(parseRememberedKm(raw({ km: 4.5, at: NOW - RIDE_REMEMBER_TTL_MS - 1 }), NOW, 12)).toBeNull();
    expect(parseRememberedKm(raw({ km: 4.5, at: NOW + MIN }), NOW, 12)).toBeNull();
    expect(parseRememberedKm(raw({ km: 12.1, at: NOW }), NOW, 12)).toBeNull();
    expect(parseRememberedKm(raw({ km: -0.1, at: NOW }), NOW, 12)).toBeNull();
  });

  test("missing or malformed values are not restored", () => {
    expect(parseRememberedKm(null, NOW, 12)).toBeNull();
    expect(parseRememberedKm("", NOW, 12)).toBeNull();
    expect(parseRememberedKm("{not json", NOW, 12)).toBeNull();
    expect(parseRememberedKm("null", NOW, 12)).toBeNull();
    expect(parseRememberedKm(raw({ km: "4.5", at: NOW }), NOW, 12)).toBeNull();
    expect(parseRememberedKm(raw({ km: 4.5 }), NOW, 12)).toBeNull();
  });
});
