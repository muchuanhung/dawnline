import { test, expect, type Page } from "@playwright/test";
import { makeRoute, segment } from "../fixtures/route";
import { stubRoutes, stubWeather } from "./stubs";

/**
 * T9 RWD: public pages must fit every width from phone to desktop without horizontal scrolling.
 * 375 = iPhone SE/mini, 768 = iPad portrait, 1024 = iPad landscape (first lg/desktop width), 1440 = laptop.
 */
const WIDTHS = [375, 768, 1024, 1440] as const;
const PAGES = ["/", "/routes", "/dashboard"] as const;

const ROUTE = makeRoute({
  segments: [segment("大安區", [0]), segment("士林區", [10, 15, 20])],
});

/** Page width beyond the viewport, in px (0 = no horizontal scroll) */
async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

test.describe("RWD 375–1440", () => {
  // Viewport is set per test, so running it once (desktop project) is enough
  test.skip(({ isMobile }) => isMobile, "viewport set per test; desktop project only");

  test.beforeEach(async ({ page }) => {
    await stubRoutes(page, [ROUTE]);
    await stubWeather(page, { 大安區: 10, 士林區: 20 });
  });

  for (const width of WIDTHS) {
    for (const path of PAGES) {
      test(`${path} 在 ${width}px 沒有橫向捲動`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(path);
        await page.waitForLoadState("networkidle");
        expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
      });
    }
  }
});

// Tablets use touch and overlay scrollbars, so emulate them with the mobile project (desktop Chrome
// reserves a 15px scrollbar gutter that shifts fixed elements off-center)
test.describe("平板（觸控）", () => {
  test.skip(({ isMobile }) => !isMobile, "touch tablet emulation; mobile project only");

  test.beforeEach(async ({ page }) => {
    await stubRoutes(page, [ROUTE]);
  });

  test("平板直向的底部面板置中、不撐滿整個寬度", async ({ page }) => {
    await page.setViewportSize({ width: 820, height: 1180 });
    await page.goto("/routes");
    await page.getByRole("button", { name: "路線列表" }).click();

    const sheet = page.getByRole("dialog");
    await expect(sheet).toBeVisible();
    const box = (await sheet.boundingBox())!;
    // md:max-w-xl = 576px, centered
    expect(box.width).toBeLessThanOrEqual(578);
    expect(Math.abs(box.x + box.width / 2 - 410)).toBeLessThanOrEqual(2);
  });
});
