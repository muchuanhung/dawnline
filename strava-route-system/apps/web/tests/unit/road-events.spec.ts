import { test, expect } from "@playwright/test";
import { buildRoutePolylineKm } from "@/lib/routes/recon-geo";
import {
  categoryOf,
  eventHazards,
  eventText,
  groupRouteEvents,
  isActive,
  matchEventsToRoute,
  parseTdxEvent,
  routineSpots,
  type RoadEvent,
} from "@/lib/routes/road-events";
import { makeRoute } from "../fixtures/route";

const NOW = new Date("2026-09-27T12:00:00+08:00");
// 測試路線往北直走 20 km：lat = 25.05 + km / 111
const latAtKm = (km: number) => 25.05 + km / 111;
const lonOffsetKm = (km: number) => km / (111.32 * Math.cos((25.1 * Math.PI) / 180));

function event(overrides: Partial<RoadEvent> = {}): RoadEvent {
  return {
    id: "e1",
    type: 1,
    subType: 101,
    title: "交通事故",
    description: "",
    lat: latAtKm(5),
    lon: 121.55,
    source: "測試",
    effectiveTime: null,
    expireTime: null,
    updatedTime: null,
    ...overrides,
  };
}

test.describe("parseTdxEvent", () => {
  test("POINT 為「經度 緯度」順序", () => {
    const e = parseTdxEvent({ EventID: "x", EventType: 2, EventSubType: 298, Positions: "POINT(121.464083 25.123769)" });
    expect(e).toMatchObject({ lon: 121.464083, lat: 25.123769, type: 2, subType: 298 });
  });

  test("沒有座標或 ID 的事件略過", () => {
    expect(parseTdxEvent({ EventID: "x", Positions: "" })).toBeNull();
    expect(parseTdxEvent({ Positions: "POINT(121 25)" })).toBeNull();
  });
});

test.describe("isActive", () => {
  test("已到期或尚未生效的事件不算", () => {
    expect(isActive(event({ expireTime: "2026-09-27T11:00:00+08:00" }), NOW)).toBe(false);
    expect(isActive(event({ effectiveTime: "2026-09-28T00:00:00+08:00" }), NOW)).toBe(false);
    expect(isActive(event({ effectiveTime: "2026-09-27T00:00:00+08:00" }), NOW)).toBe(true);
  });
});

test.describe("categoryOf", () => {
  test("依 TDX 道路事件 v1 官方 EventType 分類", () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9].map(categoryOf)).toEqual([
      "accident",
      "construction",
      "congestion",
      "control",
      "weather",
      "disaster",
      "activity",
      "anomaly",
      "other",
    ]);
  });
});

test.describe("matchEventsToRoute", () => {
  const polyline = buildRoutePolylineKm(makeRoute());

  test("路線 150 m 內的事件對應到里程；300 m 外不算", () => {
    const near = event({ id: "near", lon: 121.55 + lonOffsetKm(0.1) });
    const far = event({ id: "far", lon: 121.55 + lonOffsetKm(0.3) });
    const matched = matchEventsToRoute([near, far], polyline, { now: NOW });
    expect(matched.map((e) => e.id)).toEqual(["near"]);
    expect(matched[0]!.km).toBeCloseTo(5, 1);
  });

  test("已到期的事件不對應", () => {
    expect(matchEventsToRoute([event({ expireTime: "2026-09-27T11:00:00+08:00" })], polyline, { now: NOW })).toHaveLength(0);
  });

  test("分級：事故影響判定；施工只列出；其他的施工（298）收合", () => {
    const matched = matchEventsToRoute(
      [
        event({ id: "acc", type: 1, subType: 101 }),
        event({ id: "work", type: 2, subType: 205, lat: latAtKm(8) }),
        event({ id: "routine", type: 2, subType: 298, lat: latAtKm(12) }),
      ],
      polyline,
      { now: NOW }
    );
    expect(matched.find((e) => e.id === "acc")!.affectsVerdict).toBe(true);
    const { notices, routine } = groupRouteEvents(matched);
    expect(notices.map((e) => e.id)).toEqual(["work"]);
    expect(routine.map((e) => e.id)).toEqual(["routine"]);
  });
});

test.describe("eventHazards", () => {
  test("只有影響判定的事件變成示警；事故為注意", () => {
    const polyline = buildRoutePolylineKm(makeRoute());
    const matched = matchEventsToRoute(
      [event({ id: "acc" }), event({ id: "work", type: 2, subType: 205, lat: latAtKm(8) })],
      polyline,
      { now: NOW }
    );
    const hazards = eventHazards(matched);
    expect(hazards).toHaveLength(1);
    expect(hazards[0]).toMatchObject({ kind: "event", level: "caution", label: "事故：交通事故" });
  });

  test("災害（6，如 605 淹水）判危險；天氣（5）與預警性封閉（402）判注意", () => {
    const polyline = buildRoutePolylineKm(makeRoute());
    const matched = matchEventsToRoute(
      [
        event({ id: "flood", type: 6, subType: 605, title: "淹水" }),
        event({ id: "fog", type: 5, subType: 501, title: "濃霧", lat: latAtKm(8) }),
        event({ id: "closed", type: 4, subType: 402, title: "預警性封閉", lat: latAtKm(12) }),
      ],
      polyline,
      { now: NOW }
    );
    const byLabel = Object.fromEntries(eventHazards(matched).map((h) => [h.label, h.level]));
    expect(byLabel).toEqual({ "災害：淹水": "risky", "天氣：濃霧": "caution", "管制：預警性封閉": "caution" });
  });
});

test.describe("同一處的例行施工", () => {
  const polyline = buildRoutePolylineKm(makeRoute());
  const routineAt = (id: string, km: number, description = "道路維護") =>
    event({ id, type: 2, subType: 298, title: "其他的施工", description, lat: latAtKm(km) });

  test("同一 EventID 重複送來只對應一次", () => {
    const matched = matchEventsToRoute([routineAt("a", 5), routineAt("a", 5)], polyline, { now: NOW });
    expect(matched.map((e) => e.id)).toEqual(["a"]);
  });

  test("不同事件、同一處且說明相同 → 併成一列並保留各筆", () => {
    const matched = matchEventsToRoute(
      [routineAt("a", 2), routineAt("b", 2.04), routineAt("c", 2.06), routineAt("d", 13.6), routineAt("e", 13.62)],
      polyline,
      { now: NOW }
    );
    const spots = routineSpots(groupRouteEvents(matched).routine);
    expect(spots.map((s) => [s.text, s.events.map((e) => e.id)])).toEqual([
      ["道路維護", ["a", "b", "c"]],
      ["道路維護", ["d", "e"]],
    ]);
    expect(spots[0]!.km).toBeCloseTo(2, 1);
  });

  test("同一處但說明不同、或相距超過 0.1 km → 分開列", () => {
    const matched = matchEventsToRoute(
      [routineAt("a", 2), routineAt("b", 2, "民生需求-新建房屋"), routineAt("c", 2.4)],
      polyline,
      { now: NOW }
    );
    const spots = routineSpots(groupRouteEvents(matched).routine);
    expect(spots.map((s) => s.events.map((e) => e.id))).toEqual([["a"], ["b"], ["c"]]);
  });

  test("沒有說明時以標題比對與顯示", () => {
    const e = routineAt("a", 2, "");
    expect(eventText(e)).toBe("其他的施工");
  });
});
