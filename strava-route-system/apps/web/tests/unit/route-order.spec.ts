import { test, expect } from "@playwright/test";
import { ORDER_MAX, parseOrderCookie, serializeOrderCookie } from "@/lib/dashboard/route-order";
import { applyOrder } from "@/lib/dashboard/my-routes";

test.describe("公開路線順序 cookie", () => {
  test("來回轉換保留順序，重複只留第一次", () => {
    const value = serializeOrderCookie(["風櫃嘴", "南鯤鯓", "風櫃嘴"]);
    expect(parseOrderCookie(value)).toEqual(["風櫃嘴", "南鯤鯓"]);
  });

  test("沒有或格式不對時回空陣列（用預設順序）", () => {
    expect(parseOrderCookie(undefined)).toEqual([]);
    expect(parseOrderCookie("")).toEqual([]);
    expect(parseOrderCookie("not json")).toEqual([]);
    expect(parseOrderCookie('{"a":1}')).toEqual([]);
    expect(parseOrderCookie('["a", 3, null, "", "b"]')).toEqual(["a", "b"]);
  });

  test(`最多 ${ORDER_MAX} 筆`, () => {
    const ids = Array.from({ length: ORDER_MAX + 5 }, (_, i) => `r${i}`);
    expect(parseOrderCookie(serializeOrderCookie(ids))).toHaveLength(ORDER_MAX);
  });

  test("套用到公開路線：新上架的放最前面，已下架的 id 略過", () => {
    const routes = [{ id: "南鯤鯓" }, { id: "風櫃嘴" }, { id: "貓空" }, { id: "新路線" }];
    const order = parseOrderCookie(serializeOrderCookie(["貓空", "已下架", "南鯤鯓", "風櫃嘴"]));
    expect(applyOrder(routes, order).map((r) => r.id)).toEqual(["新路線", "貓空", "南鯤鯓", "風櫃嘴"]);
  });
});
