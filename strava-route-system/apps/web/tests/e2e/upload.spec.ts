import { test, expect } from "@playwright/test";
import { NO_ACCOUNT_REASON, hasTestAccount } from "../setup/auth-state";
import {
  deleteRoutesNamed,
  findRouteByName,
  hasUploadQuota,
  swipeLeft,
  uniqueRouteName,
  uploadViaPage,
  verdictStatus,
} from "./private-route-utils";

/**
 * T3「我的路線」上傳 E2E：上傳 → 判讀 → 刪除，桌機與手機各跑一次（T9 收尾）。
 *
 * 用測試帳號打真的後端與 S3（presigned 直傳），所以只在登入組跑：
 * 桌機在 e2e-dashboard，手機在 e2e-auth-mobile（Pixel 7）。沒有測試帳號時整組跳過。
 * 每次上傳的路線名稱都不同，結束時一定刪掉，帳號原本的路線不受影響。
 */

test.describe("我的路線：上傳 → 判讀 → 刪除（已登入）", () => {
  test.skip(!hasTestAccount(), NO_ACCOUNT_REASON);

  /** 測試中上傳過的路線；不論成功或失敗都在結束時刪掉 */
  const uploaded: string[] = [];

  test.afterEach(async ({ page }) => {
    await deleteRoutesNamed(page.request, uploaded.splice(0));
  });

  test("桌機：上傳後右側直接判讀，⋮ 選單刪除", async ({ page, isMobile }) => {
    test.skip(isMobile, "桌機流程");
    await page.goto("/routes/private");
    test.skip(!(await hasUploadQuota(page.request)), "測試帳號的路線額度已滿");

    const name = uniqueRouteName("桌機");
    uploaded.push(name);
    const route = await uploadViaPage(page, name);

    // 上傳完直接選取新路線：網址帶 ?route=，右側出現判讀
    await expect(page).toHaveURL(new RegExp(`[?&]route=${route.id}`));
    await expect(page.getByRole("link", { name, exact: true })).toHaveAttribute("aria-current", "true");
    await expect(page.getByRole("region", { name: "沿線影像與判定" })).toBeVisible({ timeout: 60_000 });
    await expect(verdictStatus(page).first()).toBeVisible({ timeout: 60_000 });

    // 刪除：⋮ 選單 → 刪除 → 瀏覽器確認框
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: `${name} 的選項` }).click();
    await page.getByRole("menuitem", { name: "刪除" }).click();
    await expect(page.getByText("已刪除")).toBeVisible();
    await expect(page.getByRole("link", { name, exact: true })).toHaveCount(0);
    expect(await findRouteByName(page.request, name)).toBeUndefined();
  });

  test("手機：上傳後打開詳情判讀，回清單左滑刪除", async ({ page, isMobile }) => {
    test.skip(!isMobile, "手機流程");
    await page.goto("/routes/private");
    test.skip(!(await hasUploadQuota(page.request)), "測試帳號的路線額度已滿");

    const name = uniqueRouteName("手機");
    uploaded.push(name);
    const route = await uploadViaPage(page, name);

    // 手機沒有右欄：點名稱進詳情頁看判讀
    await page.getByRole("link", { name, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/routes/private/${route.id}`));
    await expect(page.getByRole("region", { name: "沿線影像與判定" })).toBeVisible({ timeout: 60_000 });
    await expect(verdictStatus(page).first()).toBeVisible({ timeout: 60_000 });

    // 回清單，左滑露出操作鈕 → 刪除 → 底部確認面板
    await page.goto("/routes/private");
    const card = page.getByRole("link", { name, exact: true });
    await expect(card).toBeVisible();
    const item = page.getByRole("listitem").filter({ has: card });
    const box = (await item.boundingBox())!;
    await swipeLeft(page, box.x + box.width - 20, box.y + box.height / 2, 200);
    await item.getByRole("button", { name: "刪除" }).click();
    const sheet = page.getByRole("dialog", { name: `刪除「${name}」？` });
    await expect(sheet).toBeVisible();
    await sheet.getByRole("button", { name: "刪除" }).click();
    await expect(page.getByText("已刪除")).toBeVisible();
    await expect(page.getByRole("link", { name, exact: true })).toHaveCount(0);
    expect(await findRouteByName(page.request, name)).toBeUndefined();
  });
});
