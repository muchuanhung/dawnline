import { test, expect, type Page } from "@playwright/test";
import { AUTH_STATE_PATH, NO_ACCOUNT_REASON, hasTestAccount } from "../setup/auth-state";
import { deleteRoutesNamed, hasUploadQuota, uniqueRouteName, uploadViaPage } from "./private-route-utils";

/**
 * T9 RWD（登入後）：登入後才看得到的頁面在 375–1440 px 都不能橫向捲動。
 * 公開頁面在 responsive.spec.ts；這裡打真的後端，所以只在 e2e-dashboard（已登入、桌機）跑，
 * viewport 每支測試自己設。路線詳情頁需要一條私人路線：開始前上傳一條暫存路線，結束時刪掉。
 */
const WIDTHS = [375, 768, 1024, 1440] as const;

async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

test.describe("登入後頁面 RWD 375–1440", () => {
  test.skip(!hasTestAccount(), NO_ACCOUNT_REASON);
  test.describe.configure({ mode: "serial" });

  const routeName = uniqueRouteName("RWD");
  let routeId: string | undefined;

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext({ storageState: AUTH_STATE_PATH });
    const page = await context.newPage();
    await page.goto("/routes/private");
    if (await hasUploadQuota(page.request)) routeId = (await uploadViaPage(page, routeName)).id;
    await context.close();
  });

  test.afterAll(async ({ browser }) => {
    const context = await browser.newContext({ storageState: AUTH_STATE_PATH });
    await deleteRoutesNamed(context.request, [routeName]);
    await context.close();
  });

  const pages: { label: string; path: () => string | undefined }[] = [
    { label: "今日判讀（已登入）", path: () => "/dashboard" },
    { label: "我的路線", path: () => "/routes/private" },
    { label: "路線詳情", path: () => (routeId ? `/routes/private/${routeId}` : undefined) },
    { label: "個人資料", path: () => "/profile" },
  ];

  for (const width of WIDTHS) {
    for (const { label, path } of pages) {
      test(`${label} 在 ${width}px 沒有橫向捲動`, async ({ page }) => {
        const url = path();
        test.skip(!url, "測試帳號的路線額度已滿，沒有暫存路線可開詳情頁");
        await page.setViewportSize({ width, height: 900 });
        await page.goto(url!);
        // 正式站的雷達、監視器會持續發請求，等不到完全閒置就以 10 秒為上限
        await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
        // 登入狀態失效會被導回 /login，那就不是在測登入後的頁面
        await expect(page).not.toHaveURL(/\/login/);
        expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
      });
    }
  }
});
