import { test, type Browser, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { AUTH_STATE_PATH, NO_ACCOUNT_REASON, hasTestAccount } from "../setup/auth-state";
import { deleteRoutesNamed, hasUploadQuota, uniqueRouteName, uploadViaPage } from "./private-route-utils";

/**
 * docs/rwd.md 的截圖：公開頁與登入後頁面在 375、768、1024、1440 各截首屏一張（JPEG）。
 * 不是檢查，只在設了 RWD_SCREENSHOT_DIR 時跑（project rwd-screens），平常的 E2E 不會跑到。
 * 帳號名稱、email、頭像一律遮住，截圖會進公開的 repo。
 */
const OUT_DIR = process.env.RWD_SCREENSHOT_DIR;
const WIDTHS = [375, 768, 1024, 1440] as const;

/** 會露出帳號資料的地方：帳號選單、頭像、email；個人資料頁的大標題就是使用者名稱 */
const personalInfo = (page: Page, isProfile: boolean) => [
  page.getByRole("button", { name: /^帳號選單/ }),
  page.locator('[data-slot="avatar"]'),
  page.locator("#display-name, #email"),
  page.getByText(/\S+@\S+\.\S+/),
  ...(isProfile ? [page.locator("main h1")] : []),
];

async function shoot(page: Page, file: string, maskPersonal: boolean) {
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
  // 等字型與圖片排好版，避免截到跳動中的畫面
  await page.waitForTimeout(1_500);
  await page.screenshot({
    path: join(OUT_DIR!, file),
    type: "jpeg",
    quality: 70,
    mask: maskPersonal ? personalInfo(page, file.startsWith("profile-")) : [],
  });
}

async function newAuthPage(browser: Browser) {
  const context = await browser.newContext({ storageState: AUTH_STATE_PATH });
  return { context, page: await context.newPage() };
}

test.describe("RWD 截圖（docs/rwd/）", () => {
  test.skip(!OUT_DIR, "只在設了 RWD_SCREENSHOT_DIR 時產生截圖");
  test.describe.configure({ mode: "serial" });
  test.setTimeout(300_000);

  test.beforeAll(() => {
    mkdirSync(OUT_DIR!, { recursive: true });
  });

  test("公開頁（未登入）", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    for (const [slug, path] of [
      ["home", "/"],
      ["routes", "/routes"],
      ["dashboard-guest", "/dashboard"],
    ] as const) {
      for (const width of WIDTHS) {
        await page.setViewportSize({ width, height: width < 768 ? 812 : 900 });
        await page.goto(path);
        await shoot(page, `${slug}-${width}.jpg`, false);
      }
    }
    await context.close();
  });

  test("登入後頁面", async ({ browser }) => {
    test.skip(!hasTestAccount(), NO_ACCOUNT_REASON);
    const { context, page } = await newAuthPage(browser);
    const routeName = uniqueRouteName("截圖");
    try {
      await page.goto("/routes/private");
      const routeId = (await hasUploadQuota(page.request)) ? (await uploadViaPage(page, routeName)).id : undefined;
      const pages: [string, string | undefined][] = [
        ["dashboard-member", "/dashboard"],
        ["private-routes", routeId ? `/routes/private?route=${routeId}` : "/routes/private"],
        ["private-route-detail", routeId && `/routes/private/${routeId}`],
        ["profile", "/profile"],
      ];
      for (const [slug, path] of pages) {
        if (!path) continue;
        for (const width of WIDTHS) {
          await page.setViewportSize({ width, height: width < 768 ? 812 : 900 });
          await page.goto(path);
          await shoot(page, `${slug}-${width}.jpg`, true);
        }
      }
    } finally {
      await deleteRoutesNamed(context.request, [routeName]);
      await context.close();
    }
  });
});
