import { test, expect } from "@playwright/test";
import {
  ACTIVITY,
  activityOfRouteType,
  climbMinFor,
  formatDuration,
  parseSpeed,
  parseSpeedPrefs,
  serializeSpeedPrefs,
  speedFor,
  speedLevelLabel,
  tripDuration,
  routeEstimate,
  climbHoursFor,
  profileAscentM,
  departureAfter,
  etaLabel,
  formatClock,
  paceFor,
  parseActivity,
  parseDeparture,
  restoreTrip,
  withTrip,
} from "@/lib/routes/trip";

const NOW = new Date("2026-10-01T08:03:00+08:00");

test.describe("行程設定", () => {
  test("運動類型依路線類型決定預設均速", () => {
    expect(activityOfRouteType("自行車")).toBe("cycling");
    expect(activityOfRouteType("跑步")).toBe("running");
    expect(activityOfRouteType("健行")).toBe("hiking");
    expect(activityOfRouteType("雪巴運動")).toBe("hiking");
    expect(activityOfRouteType("混合")).toBe("cycling");
    expect(activityOfRouteType(undefined)).toBe("cycling");
    expect(ACTIVITY.running.speedKmh).toBeLessThan(ACTIVITY.cycling.speedKmh);
    expect(ACTIVITY.hiking.speedKmh).toBeLessThan(ACTIVITY.running.speedKmh);
  });

  test("運動類型參數只接受已知值", () => {
    expect(parseActivity("hiking")).toBe("hiking");
    expect(parseActivity("swimming")).toBeNull();
    expect(parseActivity(null)).toBeNull();
  });

  test("出發時間：無效、太舊或太遠一律視為現在（null）", () => {
    expect(parseDeparture("2026-10-01T10:00:00+08:00", NOW)?.toISOString()).toBe("2026-10-01T02:00:00.000Z");
    expect(parseDeparture("2026-10-01T07:55:00+08:00", NOW)).not.toBeNull(); // 15 分鐘內的過去仍可
    expect(parseDeparture("2026-10-01T07:00:00+08:00", NOW)).toBeNull();
    expect(parseDeparture("2026-10-09T08:00:00+08:00", NOW)).toBeNull();
    expect(parseDeparture("明天早上", NOW)).toBeNull();
    expect(parseDeparture(undefined, NOW)).toBeNull();
  });

  test("幾小時後出發取整 10 分鐘；0 小時為現在", () => {
    expect(departureAfter(NOW, 0)).toBe(NOW);
    expect(departureAfter(NOW, 2).toISOString()).toBe("2026-10-01T02:00:00.000Z");
  });

  test("時間以台灣時間顯示，跨日標示明日", () => {
    expect(formatClock(new Date("2026-10-01T09:40:00+08:00"), NOW)).toBe("09:40");
    expect(formatClock(new Date("2026-10-02T06:05:00+08:00"), NOW)).toBe("明日 06:05");
    expect(formatClock(new Date("2026-10-04T06:05:00+08:00"), NOW)).toBe("10/04 06:05");
  });

  test("預估到達時間＝出發時間＋里程÷均速", () => {
    const depart = "2026-10-01T00:00:00.000Z"; // 08:00 出發
    expect(etaLabel(30, depart, 20, NOW)).toBe("09:30");
    expect(etaLabel(30, depart, 4, NOW)).toBe("15:30");
  });

  test("健行依爬升加時間（每 100 m 加 10 分鐘）", () => {
    // 0–6 km 爬升 600 m，6–10 km 下降 300 m（下降不加時間）
    const profile: [number, number][] = [[0, 100], [6, 700], [10, 400]];
    const depart = "2026-10-01T00:00:00.000Z";
    const hiking = paceFor("hiking", profile);
    expect(etaLabel(6, depart, hiking, NOW)).toBe("10:30"); // 6/4 = 1.5 h + 600 m = 1 h
    expect(etaLabel(3, depart, hiking, NOW)).toBe("09:15"); // 0.75 h + 300 m 內插 = 0.5 h
    expect(etaLabel(10, depart, hiking, NOW)).toBe("11:30"); // 2.5 h + 1 h
    expect(paceFor("hiking", [])).toBe(4);
  });

  test("自行車每爬升 100 m 加 4 分鐘、跑步加 6 分鐘；下坡不加", () => {
    const profile: [number, number][] = [[0, 100], [6, 700], [10, 400]];
    const depart = "2026-10-01T00:00:00.000Z"; // 08:00 出發
    const cycling = paceFor("cycling", profile);
    expect(etaLabel(6, depart, cycling, NOW)).toBe("08:42"); // 6/20 h = 18 分 + 600 m × 4 = 24 分
    expect(etaLabel(10, depart, cycling, NOW)).toBe("08:54"); // 30 分 + 24 分（下坡 300 m 不加）
    const running = paceFor("running", profile);
    expect(etaLabel(6, depart, running, NOW)).toBe("09:12"); // 36 分 + 600 m × 6 = 36 分
  });

  test("有爬升的路線比平路晚到；平路結果不變", () => {
    const depart = "2026-10-01T00:00:00.000Z";
    const flat: [number, number][] = [[0, 50], [12.7, 50], [25.4, 50]];
    const climb: [number, number][] = [[0, 50], [12.7, 678], [25.4, 50]];
    for (const activity of ["cycling", "running"] as const) {
      const flatHours = (paceFor(activity, flat) as (km: number) => number)(25.4);
      const climbHours = (paceFor(activity, climb) as (km: number) => number)(25.4);
      expect(flatHours).toBeCloseTo(25.4 / ACTIVITY[activity].speedKmh, 6);
      expect(climbHours).toBeGreaterThan(flatHours);
    }
    // 沒有高程資料時退回均速
    expect(paceFor("cycling", [])).toBe(20);
    expect(etaLabel(25.4, depart, paceFor("cycling", flat), NOW)).toBe(etaLabel(25.4, depart, 20, NOW));
  });

  test("風櫃嘴（25.4 km、爬升 628 m）自行車約 1 小時 41 分（原本 1 小時 16 分）", () => {
    const fengguizui: [number, number][] = [[0, 20], [12.7, 648], [25.4, 20]];
    const hours = (paceFor("cycling", fengguizui) as (km: number) => number)(25.4);
    expect(Math.round(hours * 60)).toBe(101); // 76 分 + 628 m × 4 分 / 100 m ≈ 25 分
    expect(Math.round((25.4 / ACTIVITY.cycling.speedKmh) * 60)).toBe(76);
  });

  test("自訂均速：範圍內才接受並對齊刻度，等於預設值視為沒自訂", () => {
    expect(parseSpeed("cycling", 25)).toBe(25);
    expect(parseSpeed("cycling", "24.6")).toBe(25);
    expect(parseSpeed("cycling", 20)).toBeNull();
    expect(parseSpeed("cycling", 80)).toBeNull();
    expect(parseSpeed("hiking", 3.4)).toBe(3.5);
    expect(parseSpeed("hiking", 20)).toBeNull();
    expect(parseSpeed("running", "abc")).toBeNull();
    expect(parseSpeed("running", "")).toBeNull();
    expect(speedFor("cycling", 30)).toBe(30);
    expect(speedFor("cycling", 99)).toBe(20);
    expect(speedFor("hiking")).toBe(4);
  });

  test("自訂均速 cookie：解析時丟掉不合法的項目，序列化順序固定", () => {
    expect(parseSpeedPrefs("cycling:25,hiking:3.5")).toEqual({ cycling: 25, hiking: 3.5 });
    expect(parseSpeedPrefs("cycling:500,swimming:2,running")).toEqual({});
    expect(parseSpeedPrefs(undefined)).toEqual({});
    expect(serializeSpeedPrefs({ hiking: 5, cycling: 25 })).toBe("cycling:25,hiking:5");
    expect(serializeSpeedPrefs({})).toBe("");
  });

  test("程度標籤：剛好在刻度上顯示程度，否則為自訂", () => {
    expect(speedLevelLabel("cycling", 20)).toBe("一般");
    expect(speedLevelLabel("cycling", 30)).toBe("競速");
    expect(speedLevelLabel("cycling", 23)).toBe("自訂");
    expect(speedLevelLabel("hiking", 3)).toBe("輕鬆");
  });

  test("爬升加時隨平地均速等比例縮放", () => {
    expect(climbMinFor("cycling")).toBe(4);
    expect(climbMinFor("cycling", 30)).toBeCloseTo(8 / 3, 6);
    expect(climbMinFor("hiking", 5)).toBe(8);
    // 平地 30 km/h、爬升 600 m：0–6 km = 12 分 + 600 m × 2.67 分 = 16 分 → 28 分
    const profile: [number, number][] = [[0, 100], [6, 700]];
    expect(etaLabel(6, "2026-10-01T00:00:00.000Z", paceFor("cycling", profile, 30), NOW)).toBe("08:28");
  });

  test("整條路線預估拆成平地與爬升：風櫃嘴自行車 20 → 30 km/h", () => {
    const fengguizui: [number, number][] = [[0, 20], [12.7, 648], [25.4, 20]];
    const normal = tripDuration("cycling", fengguizui, 25.4);
    expect(formatDuration(normal.flatHours)).toBe("1h 16m");
    expect(formatDuration(normal.climbHours)).toBe("25m");
    expect(formatDuration(normal.flatHours + normal.climbHours)).toBe("1h 41m");
    const fast = tripDuration("cycling", fengguizui, 25.4, 30);
    expect(formatDuration(fast.flatHours)).toBe("51m");
    expect(formatDuration(fast.climbHours)).toBe("17m");
    expect(tripDuration("cycling", [], 25.4).climbHours).toBe(0);
  });

  test("路線預估：依路線類型挑運動、套用該運動的自訂均速", () => {
    const route = { type: "自行車" as const, distance: 25.4, elevationProfile: [[0, 20], [12.7, 648], [25.4, 20]] as [number, number][] };
    const normal = routeEstimate(route, { activity: null });
    expect(normal.activity).toBe("cycling");
    expect(formatDuration(normal.flatHours + normal.climbHours)).toBe("1h 41m");
    // 只設了健行的均速，不影響自行車
    expect(routeEstimate(route, { activity: null, speeds: { hiking: 5 } }).speedKmh).toBe(20);
    expect(routeEstimate(route, { activity: null, speeds: { cycling: 30 } }).speedKmh).toBe(30);
    expect(routeEstimate(route, { activity: "hiking", speeds: { hiking: 5 } }).speedKmh).toBe(5);
  });

  test("面板試算只用總爬升，結果與逐里程的 pace 相同", () => {
    const profile: [number, number][] = [[0, 20], [12.7, 648], [25.4, 20]];
    expect(profileAscentM(profile)).toBe(628);
    for (const speed of [20, 30]) {
      expect(climbHoursFor("cycling", 628, speed)).toBeCloseTo(tripDuration("cycling", profile, 25.4, speed).climbHours, 9);
    }
  });

  test("連結帶著行程設定", () => {
    expect(withTrip("/routes?route=a", { depart: "2026-10-01T02:00:00.000Z", activity: "hiking" })).toBe(
      "/routes?route=a&depart=2026-10-01T02%3A00%3A00.000Z&activity=hiking"
    );
    expect(withTrip("/routes", { activity: "running" })).toBe("/routes?activity=running");
    expect(withTrip("/routes?route=a", {})).toBe("/routes?route=a");
  });
});

test.describe("切頁沿用行程設定", () => {
  test("還原記住的出發時間與運動類型", () => {
    expect(restoreTrip("depart=2026-10-01T10%3A00%3A00%2B08%3A00&activity=hiking", NOW)).toEqual({
      depart: "2026-10-01T10:00:00+08:00",
      activity: "hiking",
    });
  });

  test("出發時間已過退回現在，不合法的運動類型退回依路線類型", () => {
    expect(restoreTrip("depart=2026-10-01T06%3A00%3A00%2B08%3A00&activity=swimming", NOW)).toEqual({
      depart: null,
      activity: null,
    });
    expect(restoreTrip(null, NOW)).toEqual({});
    expect(restoreTrip("", NOW)).toEqual({});
  });

  test("還原結果接回 withTrip 連結", () => {
    expect(withTrip("/routes", restoreTrip("activity=cycling", NOW))).toBe("/routes?activity=cycling");
  });
});
