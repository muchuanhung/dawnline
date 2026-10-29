import { test, expect } from "@playwright/test";
import { NO_ACCOUNT_REASON, hasTestAccount } from "../setup/auth-state";

// 判讀在伺服器端取得路線與 CWB 天氣，無法以 page.route 攔截；
// 只驗證結構與導覽，不驗證判定結果本身（結果由 tests/unit/briefing.spec.ts 涵蓋）
const VERDICT_WORD = /^(安全|注意|危險|未判定)$/;

test.describe("Dashboard 今日判讀", () => {
  // 只有登入狀態的測試需要測試帳號；未登入那組不需要
  test.skip(!hasTestAccount(), NO_ACCOUNT_REASON);

  test("開啟即看到判定板，且不依賴 Strava", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { level: 1, name: "現在出發適合嗎？" })).toBeVisible();

    const verdict = page.getByRole("heading", { level: 2, name: VERDICT_WORD });
    const empty = page.getByRole("heading", { name: "目前沒有可判讀的路線" });
    await expect(verdict.or(empty)).toBeVisible({ timeout: 30_000 });

    await expect(page.getByText(/Strava/)).toHaveCount(0);
  });

  test("切換路線會更新網址並標示目前路線", async ({ page }) => {
    await page.goto("/dashboard");
    // 先等串流內容到齊，否則切換器還沒出現就會被誤判為「沒有切換器」而跳過
    await expect(page.getByRole("heading", { level: 2, name: VERDICT_WORD })).toBeVisible({ timeout: 30_000 });
    const switcher = page.getByRole("navigation", { name: "切換路線" });
    test.skip((await switcher.count()) === 0, "路線少於兩條，沒有切換器");

    const target = switcher.getByRole("link").nth(1);
    const name = (await target.textContent())!.trim();
    await target.click();

    await expect(page).toHaveURL(/\/dashboard\?route=/);
    await expect(switcher.getByRole("link", { name })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("heading", { level: 2, name: VERDICT_WORD })).toBeVisible({ timeout: 30_000 });
  });

  test("主要導覽標示目前頁面", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(
      page.getByRole("navigation", { name: "主要導覽" }).getByRole("link", { name: "今日判讀" }).first()
    ).toHaveAttribute("aria-current", "page");
    // 桌機：個人資料不在分頁裡，改在右側帳號選單
    await expect(page.getByRole("navigation", { name: "主要導覽" }).first().getByRole("link", { name: "個人資料" })).toHaveCount(0);
    await page.getByRole("button", { name: /^帳號選單/ }).click();
    await expect(page.getByRole("menuitem", { name: "個人資料" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "登出" })).toBeVisible();
  });

  test("「看逐段示警與 CCTV」帶著目前路線前往 /routes", async ({ page }) => {
    await page.goto("/dashboard");
    const link = page.getByRole("link", { name: "看逐段示警與 CCTV" });
    await expect(link).toBeVisible({ timeout: 30_000 });
    await expect(link).toHaveAttribute("href", /^\/routes\?route=/);
    await link.click();
    await expect(page).toHaveURL(/\/routes\?route=/);
  });
});

test.describe("未登入", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("直接開 /dashboard 看得到公開路線判讀，不被導到登入頁", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByRole("heading", { level: 1, name: "現在出發適合嗎？" })).toBeVisible();

    const verdict = page.getByRole("heading", { level: 2, name: VERDICT_WORD });
    const empty = page.getByRole("heading", { name: "目前沒有可判讀的路線" });
    await expect(verdict.or(empty)).toBeVisible({ timeout: 30_000 });
  });

  test("有登入入口與收藏說明，判讀下方有資料時間與免責", async ({ page }) => {
    await page.goto("/dashboard");
    const notice = page.getByRole("region", { name: "未登入" });
    await expect(notice).toContainText("登入後可收藏路線");
    await expect(notice.getByRole("link", { name: "登入" })).toHaveAttribute("href", "/login");

    await expect(page.getByRole("heading", { level: 2, name: VERDICT_WORD })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/^資料時間/)).toBeVisible();
  });
});
