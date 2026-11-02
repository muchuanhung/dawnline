import { test, expect, type APIRequestContext } from "@playwright/test";
import { NO_ACCOUNT_REASON, hasTestAccount } from "../setup/auth-state";
import { MY_ROUTES_MAX, pickMyRoutes } from "@/lib/dashboard/my-routes";
import type { RouteOrder } from "@/lib/dashboard/route-order";
import type { FavoriteList } from "@/lib/routes/favorites";
import type { PrivateRouteList } from "@/lib/routes/private-routes";
import type { PublicRouteMeta } from "@/lib/routes/public-routes.server";

/**
 * 收藏（T6）與今日判讀「我的路線」（T8）的登入後 E2E。
 *
 * 用測試帳號打真的後端（/api/v1/* 經 Next rewrite 轉到 BACKEND_API_URL），所以：
 * - 只在 e2e-dashboard project 跑（帶登入狀態），沒有測試帳號時整組跳過；
 * - 兩個測試都讀寫同一個帳號的收藏，整個檔案依序執行；
 * - 測試只收藏「原本沒收藏」的路線，結束一定取消，帳號的收藏與排序維持原樣。
 */

const VERDICT_WORD = /^(安全|注意|危險|未判定)$/;

async function getJson<T>(api: APIRequestContext, path: string): Promise<T> {
  const res = await api.get(path);
  expect(res.ok(), `${path} → ${res.status()}`).toBeTruthy();
  return (await res.json()) as T;
}

const favoriteIds = async (api: APIRequestContext) =>
  (await getJson<FavoriteList>(api, "/api/v1/favorites")).favorites.map((f) => f.id);

const publicRouteIds = async (api: APIRequestContext) =>
  (await getJson<{ routes: PublicRouteMeta[] }>(api, "/api/v1/public-routes")).routes.map((r) => r.id);

/** 帳號還沒收藏的第一條公開路線；都收藏了回 undefined */
async function unfavoritedPublicRoute(api: APIRequestContext): Promise<string | undefined> {
  const favs = new Set(await favoriteIds(api));
  return (await publicRouteIds(api)).find((id) => !favs.has(id));
}

test.describe("收藏與我的路線（已登入）", () => {
  test.skip(!hasTestAccount(), NO_ACCOUNT_REASON);
  test.describe.configure({ mode: "serial" });

  /** 測試中加過的收藏；不論成功或失敗都在結束時取消 */
  let added: string | undefined;

  test.afterEach(async ({ page }) => {
    if (added) await page.request.delete(`/api/v1/favorites/${encodeURIComponent(added)}`);
    added = undefined;
  });

  test("T6 收藏、只看收藏、取消收藏：畫面與後端一致，重新整理後仍在", async ({ page }) => {
    const api = page.request;
    const target = await unfavoritedPublicRoute(api);
    test.skip(!target, "測試帳號已收藏全部公開路線，沒有可測的路線");
    added = target;

    // 桌機：清單與詳情同一頁，星號按鈕在詳情標題列
    await page.goto(`/routes?route=${encodeURIComponent(target!)}`);

    // 收藏：星號變成「取消收藏」，後端收藏清單第一筆就是它（新的在前）
    await page.getByRole("button", { name: "收藏這條路線" }).click();
    await expect(page.getByRole("button", { name: "取消收藏" })).toHaveAttribute("aria-pressed", "true");
    await expect.poll(async () => (await favoriteIds(api))[0]).toBe(target);

    // 重新整理後仍是已收藏（不是只有樂觀更新）
    await page.reload();
    await expect(page.getByRole("button", { name: "取消收藏" })).toBeVisible({ timeout: 15_000 });

    // 我的收藏：「收藏」篩選打開後，清單每張卡都帶已收藏星號，且包含這條路線（目前選中的卡）
    const list = page.getByRole("complementary", { name: "路線清單" });
    await list.getByRole("button", { name: "收藏", exact: true }).click();
    await expect(list.getByRole("button", { name: "收藏", exact: true })).toHaveAttribute("aria-pressed", "true");
    const cards = list.getByRole("button").filter({ has: page.getByRole("img", { name: "已收藏" }) });
    const favs = new Set(await favoriteIds(api));
    const publicFavs = (await publicRouteIds(api)).filter((id) => favs.has(id));
    await expect(cards).toHaveCount(publicFavs.length);

    // 取消收藏：星號恢復、後端清單不再有它
    await page.getByRole("button", { name: "取消收藏" }).click();
    await expect(page.getByRole("button", { name: "收藏這條路線" })).toHaveAttribute("aria-pressed", "false");
    await expect.poll(async () => (await favoriteIds(api)).includes(target!)).toBe(false);
    added = undefined;
  });

  test("T8 有收藏時，今日判讀切換列依「我的路線」順序顯示前 5 條，收藏帶星號", async ({ page }) => {
    const api = page.request;
    // 帳號沒有收藏時先收藏一條，確保測到「有收藏」的情境
    if ((await favoriteIds(api)).length === 0) {
      const target = await unfavoritedPublicRoute(api);
      test.skip(!target, "沒有公開路線可收藏");
      const res = await api.put(`/api/v1/favorites/${encodeURIComponent(target!)}`);
      expect(res.ok()).toBeTruthy();
      added = target;
    }

    // 預期順序：與伺服器 loadMyRoutes 同一個純函式、同一份後端資料
    const [{ favorites }, { routes }, order, publicIds] = await Promise.all([
      getJson<FavoriteList>(api, "/api/v1/favorites"),
      getJson<PrivateRouteList>(api, "/api/v1/routes"),
      // 與 loadMyRoutes 相同：自訂順序讀不到就用預設順序
      getJson<RouteOrder>(api, "/api/v1/me/route-order").then(
        (r) => r.ids,
        () => [] as string[]
      ),
      publicRouteIds(api),
    ]);
    const expected = pickMyRoutes(favorites, routes, new Set(publicIds), Number.POSITIVE_INFINITY, order);
    expect(expected.length).toBeGreaterThan(0);

    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { level: 2, name: VERDICT_WORD })).toBeVisible({ timeout: 30_000 });

    const switcher = page.getByRole("navigation", { name: "切換路線" });
    const chips = switcher.getByRole("link");
    await expect(chips).toHaveCount(Math.min(expected.length, MY_ROUTES_MAX));
    const shownIds = await chips.evaluateAll((links) =>
      links.map((a) => new URL((a as HTMLAnchorElement).href).searchParams.get("route"))
    );
    expect(shownIds).toEqual(expected.slice(0, MY_ROUTES_MAX).map((r) => r.id));

    // 第一條是預設判讀的路線；收藏的才有星號，自己上傳的沒有
    await expect(chips.first()).toHaveAttribute("aria-current", "page");
    for (const [i, route] of expected.slice(0, MY_ROUTES_MAX).entries()) {
      await expect(chips.nth(i).getByRole("img", { name: "收藏" })).toHaveCount(route.source === "favorite" ? 1 : 0);
    }
    await expect(switcher.getByRole("button", { name: `全部 ${expected.length} 條` })).toBeVisible();
  });
});
