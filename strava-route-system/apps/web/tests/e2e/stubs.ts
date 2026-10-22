import type { Page } from "@playwright/test";
import type { CCTVFeed, Route } from "@/lib/routes/route-data";
import type { RoadEvent } from "@/lib/routes/road-events";
import { briefRoute, districtKey, type DistrictWeather } from "@/lib/dashboard/briefing";

/**
 * 以假資料攔截瀏覽器端 API，測試不打真的 CWB／TDX，結果固定且不需要金鑰。
 *
 * 路線頁的判讀由伺服器算好，瀏覽器向 /api/routes/briefing 取；伺服器端對 CWB／TDX 的請求攔不到，
 * 所以在這一層攔截：用與伺服器相同的純函式 briefRoute，拿這裡設定的假天氣、假路況算出判讀回給頁面。
 * 判定規則是真的在跑，只有資料來源是假的。
 */

type Weather = Record<string, number> | "error";
type Events = RoadEvent[] | "error";

interface StubState {
  routes: Route[];
  weather: Weather;
  events: Events;
}

const states = new WeakMap<Page, StubState>();

/** 依目前設定算出某條路線的判讀（與 get-briefing.server 同一個 briefRoute） */
function briefingFor(state: StubState, routeId: string) {
  const route = state.routes.find((r) => r.id === routeId);
  if (!route) return null;
  const lookup = new Map<string, DistrictWeather>();
  if (state.weather !== "error") {
    for (const seg of route.segments) {
      if (!seg.county || !seg.districtZh || !(seg.districtZh in state.weather)) continue;
      const pop = state.weather[seg.districtZh]!;
      lookup.set(districtKey(seg.county, seg.districtZh), {
        rainProbability: pop,
        windSpeedKmh: 8,
        temperature: 25,
        condition: pop >= 60 ? "rainy" : "cloudy",
        periodLabel: "今天 06:00–18:00",
      });
    }
  }
  return briefRoute(route, lookup, {
    events: state.events === "error" ? [] : state.events,
    eventsFailed: state.events === "error" ? null : [],
    suggest: true,
  });
}

/** 第一次設定時註冊判讀攔截；之後只改設定，請求當下才讀，順序不拘 */
function stateOf(page: Page): StubState {
  let state = states.get(page);
  if (!state) {
    const created: StubState = { routes: [], weather: {}, events: [] };
    states.set(page, created);
    state = created;
    void page.route("**/api/routes/briefing?**", (r) => {
      const id = new URL(r.request().url()).searchParams.get("route") ?? "";
      const briefing = briefingFor(created, id);
      return briefing ? r.fulfill({ json: briefing }) : r.fulfill({ status: 404, json: { error: "找不到路線" } });
    });
  }
  return state;
}

export async function stubRoutes(page: Page, routes: Route[]) {
  stateOf(page).routes = routes;
  await page.route("**/api/routes/gpx", (r) => r.fulfill({ json: routes }));
  // 預設沒有路況事件
  await stubEvents(page, []);
  // 預設雷達取不到，主視覺維持原樣；要測雷達時另外呼叫 stubRadar
  await stubRadar(page, "error");
}

/** 1×1 透明 PNG：雷達圖內容不重要，只測入口與文字 */
const BLANK_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64"
);

/**
 * 雷達回波：最新一張的觀測時間（ISO）或 "error"；清單會往前補到 6 小時（每小時一張）。
 * 後註冊的攔截優先，可覆蓋 stubRoutes 的預設。
 */
export async function stubRadar(page: Page, latestObservedAt: string | "error") {
  await page.route("**/api/radar", (r) => {
    if (latestObservedAt === "error") return r.fulfill({ status: 502, json: { error: "雷達資料暫時取不到" } });
    const latest = Date.parse(latestObservedAt);
    const frames = Array.from({ length: 7 }, (_, i) => {
      const t = new Date(latest - (6 - i) * 3600 * 1000 + 8 * 3600 * 1000).toISOString();
      const id = t.slice(0, 16).replace(/\D/g, "");
      return { id, observedAt: `${t.slice(0, 16)}:00+08:00` };
    });
    return r.fulfill({ json: { frames, nowcast: null } });
  });
  await page.route("**/api/radar/frame?**", (r) => r.fulfill({ contentType: "image/png", body: BLANK_PNG }));
  await page.route("**/api/radar/basemap", (r) => r.fulfill({ json: { towns: "" } }));
}

/** 路況事件；"error" 模擬 TDX 失敗（判讀端 eventsFailed 為 null） */
export async function stubEvents(page: Page, events: Events) {
  stateOf(page).events = events;
  await page.route("**/api/road-events?**", (r) =>
    events === "error"
      ? r.fulfill({ status: 500, json: { error: "TDX 請求失敗" } })
      : r.fulfill({ json: { events, failed: [] } })
  );
}

/** 依行政區設定降雨機率；"error" 模擬 CWB 失敗（判讀端沒有任何天氣） */
export async function stubWeather(page: Page, rainByDistrict: Weather) {
  stateOf(page).weather = rainByDistrict;
}

/** "error" 模擬 CCTV API 失敗 */
export async function stubCctv(page: Page, feeds: CCTVFeed[] | "error") {
  await page.route("**/api/cctv/near-route**", (r) =>
    feeds === "error"
      ? r.fulfill({ status: 500, json: { error: "TDX 請求失敗" } })
      : r.fulfill({ json: feeds })
  );
}
