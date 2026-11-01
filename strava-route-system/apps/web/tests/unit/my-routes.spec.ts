import { test, expect } from "@playwright/test";
import { MY_ROUTES_MAX, applyOrder, pickMyRoutes } from "@/lib/dashboard/my-routes";
import type { FavoriteItem } from "@/lib/routes/favorites";
import type { PrivateRoute } from "@/lib/routes/private-routes";

const fav = (id: string, visibility: "public" | "private", name = id): FavoriteItem => ({
  id,
  visibility,
  name,
  createdAt: "2026-10-31T00:00:00Z",
});

const own = (id: string, createdAt: string, status: PrivateRoute["status"] = "ready", name = id): PrivateRoute => ({
  id,
  name,
  type: "自行車",
  status,
  distanceKm: 30,
  elevationGainM: 500,
  fileSize: 1000,
  createdAt,
});

const PUBLIC = new Set(["maokong", "fengguizui", "nankunshen"]);

test.describe("pickMyRoutes", () => {
  test("收藏在前（保留後端順序），再補自己上傳、未收藏的路線（新到舊）", () => {
    const picked = pickMyRoutes(
      [fav("fengguizui", "public"), fav("P1", "private")],
      [own("P1", "2026-10-01T00:00:00Z"), own("P2", "2026-10-02T00:00:00Z"), own("P3", "2026-10-03T00:00:00Z")],
      PUBLIC
    );
    expect(picked.map((r) => [r.id, r.source])).toEqual([
      ["fengguizui", "favorite"],
      ["P1", "favorite"],
      ["P3", "own"],
      ["P2", "own"],
    ]);
  });

  test(`最多 ${MY_ROUTES_MAX} 條，收藏優先佔位`, () => {
    const picked = pickMyRoutes(
      [fav("maokong", "public"), fav("fengguizui", "public"), fav("nankunshen", "public")],
      ["A", "B", "C", "D"].map((id, i) => own(id, `2026-10-0${i + 1}T00:00:00Z`)),
      PUBLIC
    );
    expect(picked.map((r) => r.id)).toEqual(["maokong", "fengguizui", "nankunshen", "D", "C"]);
  });

  test("已下架的公開收藏、處理中或失敗的私人路線都不顯示", () => {
    const picked = pickMyRoutes(
      [fav("gone", "public"), fav("P1", "private"), fav("P9", "private")],
      [own("P1", "2026-10-01T00:00:00Z", "processing"), own("P2", "2026-10-02T00:00:00Z", "failed")],
      PUBLIC
    );
    expect(picked).toEqual([]);
  });

  test("私人收藏的名稱以自己的路線清單為準（改名後立即反映）", () => {
    const picked = pickMyRoutes([fav("P1", "private", "舊名")], [own("P1", "2026-10-01T00:00:00Z", "ready", "新名")], PUBLIC);
    expect(picked).toEqual([{ id: "P1", name: "新名", visibility: "private", source: "favorite" }]);
  });

  test("沒有收藏也沒有上傳時回空陣列", () => {
    expect(pickMyRoutes([], [], PUBLIC)).toEqual([]);
  });
});

test.describe("自訂順序（applyOrder／pickMyRoutes order）", () => {
  const routes = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];

  test("沒排過時維持預設順序", () => {
    expect(applyOrder(routes, []).map((r) => r.id)).toEqual(["a", "b", "c", "d"]);
  });

  test("依自訂順序排列；已不存在的 id 略過", () => {
    expect(applyOrder(routes, ["d", "gone", "b", "a", "c"]).map((r) => r.id)).toEqual(["d", "b", "a", "c"]);
  });

  test("還沒排進去的新路線放最前面，彼此維持預設順序", () => {
    expect(applyOrder(routes, ["c", "a"]).map((r) => r.id)).toEqual(["b", "d", "c", "a"]);
  });

  test("pickMyRoutes 先套自訂順序再取前 max 條", () => {
    const picked = pickMyRoutes(
      [fav("maokong", "public"), fav("fengguizui", "public")],
      [own("P1", "2026-10-01T00:00:00Z"), own("P2", "2026-10-02T00:00:00Z")],
      PUBLIC,
      2,
      ["P1", "maokong", "fengguizui", "P2"]
    );
    expect(picked.map((r) => r.id)).toEqual(["P1", "maokong"]);
  });
});
