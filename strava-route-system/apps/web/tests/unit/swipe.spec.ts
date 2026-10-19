import { test, expect } from "@playwright/test";
import { settleSwipe, swipeDirection, swipeOffset } from "@/lib/swipe";

const W = 152;

test.describe("swipe", () => {
  test("位移限制在 [-width, 0]", () => {
    expect(swipeOffset(0, -40, W)).toBe(-40);
    expect(swipeOffset(0, -400, W)).toBe(-W);
    expect(swipeOffset(0, 30, W)).toBe(0);
    // 已打開時往右滑會收回
    expect(swipeOffset(-W, 60, W)).toBe(-W + 60);
    expect(swipeOffset(-W, 400, W)).toBe(0);
  });

  test("滑過一半才打開", () => {
    expect(settleSwipe(-W / 2 - 1, W)).toBe(true);
    expect(settleSwipe(-W / 2, W)).toBe(false);
    expect(settleSwipe(0, W)).toBe(false);
    expect(settleSwipe(-W, W)).toBe(true);
  });

  test("移動太少不判方向；水平大於垂直才算左右滑", () => {
    expect(swipeDirection(3, 4)).toBeNull();
    expect(swipeDirection(-20, 5)).toBe("horizontal");
    expect(swipeDirection(5, 20)).toBe("vertical");
    expect(swipeDirection(-10, 10)).toBe("vertical");
  });
});
