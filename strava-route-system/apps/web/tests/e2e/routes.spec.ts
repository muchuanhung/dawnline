import { test, expect, type Page } from "@playwright/test";
import { CCTV_FEED, makeRoute, segment, slopeProfile } from "../fixtures/route";
import { stubCctv, stubEvents, stubRoutes, stubWeather } from "./stubs";

// 大安區在起點；士林區涵蓋 10 km 之後，兩區以取樣點中點（5 km）分段，士林區的示警從 5.0 km 開始
const ROUTE = makeRoute({
  segments: [segment("大安區", [0]), segment("士林區", [10, 15, 20])],
});

const verdictBar = (page: Page) =>
  page.getByRole("status").filter({ hasText: /危險|注意|安全|未判定/ });

test.describe("/routes 路線偵察", () => {
  test.beforeEach(async ({ page }) => {
    await stubRoutes(page, [ROUTE]);
  });

  test("危險天氣時，判定列在最上層並說明原因", async ({ page }) => {
    await stubWeather(page, { 大安區: 10, 士林區: 70 });
    await stubCctv(page, [CCTV_FEED]);
    await page.goto("/routes");

    const verdict = verdictBar(page);
    await expect(verdict).toContainText("危險");
    await expect(verdict).toContainText("5.0 km 起降雨 70%");

    // 資訊層級：判定 → 示警 → 高程圖 → 監視器
    const order = await Promise.all(
      [
        verdict,
        page.getByRole("region", { name: /沿途示警/ }),
        page.getByRole("region", { name: "海拔與位置" }),
        page.getByRole("region", { name: /沿途監視器/ }),
      ].map(async (l) => (await l.boundingBox())!.y)
    );
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  test("判定列不用捲動就看得到", async ({ page }) => {
    await stubWeather(page, { 大安區: 10, 士林區: 70 });
    await stubCctv(page, [CCTV_FEED]);
    await page.goto("/routes");
    await expect(verdictBar(page)).toBeInViewport();
  });

  test("天氣 API 失敗時顯示未判定，絕不顯示安全", async ({ page }) => {
    await stubWeather(page, "error");
    await stubCctv(page, [CCTV_FEED]);
    await page.goto("/routes");

    await expect(verdictBar(page)).toContainText("未判定");
    await expect(verdictBar(page)).toContainText("尚無天氣資料");
    await expect(page.getByText("此處無天氣資料", { exact: true })).toBeVisible();
    await expect(page.getByText("安全", { exact: true })).toHaveCount(0);
  });

  test("點示警會把位置移到該處", async ({ page }) => {
    await stubWeather(page, { 大安區: 10, 士林區: 70 });
    await stubCctv(page, [CCTV_FEED]);
    await page.goto("/routes");

    const readout = page.getByRole("region", { name: "海拔與位置" });
    await expect(readout).not.toContainText("5.0 km");
    await page.getByRole("button", { name: /降雨 70%/ }).click();
    await expect(readout).toContainText("5.0 km");
  });

  test("CCTV 載入失敗與沿途無監視器分開顯示", async ({ page }) => {
    await stubWeather(page, { 大安區: 10, 士林區: 10 });
    await stubCctv(page, "error");
    await page.goto("/routes");
    await expect(page.getByText("監視器載入失敗")).toBeVisible();
  });
});

test.describe("/routes 與 Dashboard 判定一致", () => {
  test("只有陡坡、天氣良好時判定為安全，且不列出陡坡", async ({ page }) => {
    const steep = makeRoute({ elevationProfile: slopeProfile(0.16), segments: ROUTE.segments });
    await stubRoutes(page, [steep]);
    await stubWeather(page, { 大安區: 10, 士林區: 10 });
    await stubCctv(page, [CCTV_FEED]);
    await page.goto("/routes");

    await expect(verdictBar(page)).toContainText("安全");
    await expect(page.getByText("沿途沒有示警")).toBeVisible();
    await expect(page.getByText(/陡升|陡降/)).toHaveCount(0);
  });

  test("?route= 直接打開指定路線", async ({ page }) => {
    const second = makeRoute({ id: "second-route", name: "Second Route", segments: ROUTE.segments });
    await stubRoutes(page, [ROUTE, second]);
    await stubWeather(page, { 大安區: 10, 士林區: 10 });
    await stubCctv(page, [CCTV_FEED]);
    await page.goto("/routes?route=second-route");

    await expect(page.getByRole("heading", { level: 2, name: "Second Route" })).toBeVisible();
  });

  test("私人路線上傳尚未完成：沒有入口，網址回 404", async ({ page }) => {
    await stubRoutes(page, [ROUTE]);
    await stubWeather(page, { 大安區: 10, 士林區: 10 });
    await stubCctv(page, [CCTV_FEED]);
    await page.goto("/routes");
    await expect(page.getByRole("link", { name: /私人路線/ })).toHaveCount(0);
    const res = await page.goto("/routes/private");
    expect(res?.status()).toBe(404);
  });
});

test.describe("/routes 路況事件分級", () => {
  // 測試路線往北直走：lat = 25.05 + km / 111、lon 固定，事件放在路線上
  const onRoute = (km: number) => ({ lat: 25.05 + km / 111, lon: 121.55 });
  const base = { description: "", source: "測試", effectiveTime: null, expireTime: null, updatedTime: null };

  test("事故判為注意；施工列在沿線路況；其他的施工收合", async ({ page }) => {
    await stubRoutes(page, [ROUTE]);
    await stubEvents(page, [
      { ...base, ...onRoute(3), id: "acc", type: 1, subType: 101, title: "交通事故" },
      { ...base, ...onRoute(6), id: "work", type: 2, subType: 205, title: "道路施工", description: "外側車道施工" },
      { ...base, ...onRoute(9), id: "r1", type: 2, subType: 298, title: "道路施工", description: "道路維護" },
      { ...base, ...onRoute(12), id: "r2", type: 2, subType: 298, title: "道路施工", description: "道路維護" },
    ]);
    await stubWeather(page, { 大安區: 10, 士林區: 10 });
    await stubCctv(page, [CCTV_FEED]);
    await page.goto("/routes");

    await expect(verdictBar(page)).toContainText("注意");
    await expect(verdictBar(page)).toContainText("事故：交通事故");
    await expect(page.getByRole("button", { name: /施工：外側車道施工/ })).toBeVisible();
    await expect(page.getByText("沿線 2 處其他施工（多為道路維護）")).toBeVisible();
    await expect(page.getByRole("button", { name: /施工：道路維護/ }).first()).toBeHidden();
  });

  test("路況事件取不到時如實告知，判未判定（不可判安全）", async ({ page }) => {
    await stubRoutes(page, [ROUTE]);
    await stubEvents(page, "error");
    await stubWeather(page, { 大安區: 10, 士林區: 10 });
    await stubCctv(page, [CCTV_FEED]);
    await page.goto("/routes");

    // 天氣良好但事件缺失：依產品鐵律不可判安全（注意「無法確認安全」也含「安全」二字，改驗未判定）
    await expect(verdictBar(page)).toContainText("未判定");
    await expect(verdictBar(page)).toContainText("路況事件暫時取不到");
    await expect(page.getByText("路況事件暫時取不到，請稍後再試。")).toBeVisible();
  });
});
