import { test, expect } from "@playwright/test";
import { parseGpxToRoute } from "@/lib/routes/parse-gpx";
import { buildRoutePolylineKm } from "@/lib/routes/recon-geo";
import { eventHazards, groupRouteEvents, matchEventsToRoute } from "@/lib/routes/road-events";
import { DEMO_EVENT_PREFIX, DEMO_ROUTE_ID, demoRoadEvents, demoRouteGpx } from "@/lib/routes/demo-route";

const NOW = new Date("2026-10-12T08:00:00+08:00");
const route = parseGpxToRoute(demoRouteGpx(), DEMO_ROUTE_ID);

test.describe("示意路線（Storage 讀不到時的備援）", () => {
  test("GPX 可由既有解析器讀成路線，約 11 km", () => {
    expect(route.id).toBe(DEMO_ROUTE_ID);
    expect(route.distance).toBeGreaterThan(10);
    expect(route.distance).toBeLessThan(13);
    expect(buildRoutePolylineKm(route)).not.toBeNull();
  });

  test("假事件全部標「示意」，且落在路線上", () => {
    const events = demoRoadEvents(route, NOW);
    expect(events.length).toBeGreaterThan(0);
    for (const e of events) {
      expect(e.title.startsWith(DEMO_EVENT_PREFIX)).toBe(true);
      expect(e.description.startsWith(DEMO_EVENT_PREFIX)).toBe(true);
    }
    // 尚未生效、已到期之外的事件都應對應到路線
    const matched = matchEventsToRoute(events, buildRoutePolylineKm(route), { now: NOW });
    expect(matched.map((e) => e.id).sort()).toEqual(
      events.map((e) => e.id).filter((id) => id !== "demo-upcoming" && id !== "demo-expired").sort()
    );
  });

  test("尚未生效與已到期的事件不列入", () => {
    const ids = matchEventsToRoute(demoRoadEvents(route, NOW), buildRoutePolylineKm(route), { now: NOW }).map(
      (e) => e.id
    );
    expect(ids).not.toContain("demo-upcoming");
    expect(ids).not.toContain("demo-expired");
  });

  test("涵蓋各類示警：災害判危險，事故／管制／天氣／異常判注意，其餘只列出", () => {
    const matched = matchEventsToRoute(demoRoadEvents(route, NOW), buildRoutePolylineKm(route), { now: NOW });
    const hazards = eventHazards(matched);
    expect(hazards.filter((h) => h.level === "risky").map((h) => h.id)).toEqual(["event-demo-disaster"]);
    expect(hazards.filter((h) => h.level === "caution").map((h) => h.id).sort()).toEqual(
      ["event-demo-accident", "event-demo-anomaly", "event-demo-control", "event-demo-weather"].sort()
    );
    const { notices, routine } = groupRouteEvents(matched);
    expect(notices.map((e) => e.id).sort()).toEqual(["demo-activity", "demo-congestion", "demo-construction"]);
    expect(routine.map((e) => e.id)).toEqual(["demo-routine"]);
  });

  test("生效時間相對判讀時間，換一天打開仍看得到同一組示警", () => {
    const later = new Date(NOW.getTime() + 3 * 86400_000);
    const ids = (now: Date) =>
      matchEventsToRoute(demoRoadEvents(route, now), buildRoutePolylineKm(route), { now }).map((e) => e.id);
    expect(ids(later)).toEqual(ids(NOW));
  });
});
