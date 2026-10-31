import { test, expect } from "@playwright/test";
import { addFavorite, applyFavorite, favoriteErrorMessage, listFavorites, removeFavorite } from "@/lib/routes/favorites";
import { BackendError } from "@/lib/routes/private-routes";

/** Replace global fetch for one test; records every call */
function mockFetch(handler: (url: string, init?: RequestInit) => Response) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    return handler(url, init);
  }) as typeof fetch;
  return { calls, restore: () => (globalThis.fetch = original) };
}

test.describe("applyFavorite", () => {
  test("加入放最前面且不重複，移除只拿掉那一條", () => {
    expect(applyFavorite(["a", "b"], "c", true)).toEqual(["c", "a", "b"]);
    expect(applyFavorite(["a", "b"], "b", true)).toEqual(["b", "a"]);
    expect(applyFavorite(["a", "b"], "a", false)).toEqual(["b"]);
    expect(applyFavorite([], "x", false)).toEqual([]);
  });
});

test.describe("favoriteErrorMessage", () => {
  test("上限、網路、過期、找不到各給一句話", () => {
    expect(favoriteErrorMessage(new BackendError(409, "favorite_limit_reached", ""), 50)).toBe("最多收藏 50 條路線");
    expect(favoriteErrorMessage(new BackendError(0, "network_error", ""), 50)).toContain("網路");
    expect(favoriteErrorMessage(new BackendError(401, "unauthenticated", ""), 50)).toContain("重新登入");
    expect(favoriteErrorMessage(new BackendError(404, "route_not_found", ""), 50)).toBe("找不到這條路線");
    expect(favoriteErrorMessage(new Error("x"), null)).toBe("收藏失敗，請再試一次");
  });
});

test.describe("favorites API", () => {
  test("PUT／DELETE 帶 cookie、id 做 URL 編碼；204 回 undefined", async () => {
    const m = mockFetch(() => new Response(null, { status: 204 }));
    try {
      await addFavorite("陽金 公路");
      await removeFavorite("01JABCDEFGHJKMNPQRSTVWXYZ0");
      expect(m.calls[0]!.url).toBe(`/api/v1/favorites/${encodeURIComponent("陽金 公路")}`);
      expect(m.calls[0]!.init?.method).toBe("PUT");
      expect(m.calls[0]!.init?.credentials).toBe("include");
      expect(m.calls[1]!.url).toBe("/api/v1/favorites/01JABCDEFGHJKMNPQRSTVWXYZ0");
      expect(m.calls[1]!.init?.method).toBe("DELETE");
    } finally {
      m.restore();
    }
  });

  test("後端錯誤轉成 BackendError（含錯誤碼）", async () => {
    const m = mockFetch(
      () => new Response(JSON.stringify({ error: { code: "favorite_limit_reached", message: "上限" } }), { status: 409 })
    );
    try {
      await expect(addFavorite("a")).rejects.toMatchObject({ status: 409, code: "favorite_limit_reached" });
    } finally {
      m.restore();
    }
  });

  test("清單打 /api/v1/favorites", async () => {
    const m = mockFetch(() => new Response(JSON.stringify({ favorites: [], limit: 50 })));
    try {
      expect(await listFavorites()).toEqual({ favorites: [], limit: 50 });
      expect(m.calls[0]!.url).toBe("/api/v1/favorites");
    } finally {
      m.restore();
    }
  });
});
