import { test, expect } from "@playwright/test";
import { GPX_MAX_BYTES, routeNameFromFile, validateGpxFile } from "@/lib/routes/private-routes";

test.describe("validateGpxFile", () => {
  test("accepts a .gpx file within the limit", () => {
    expect(validateGpxFile({ name: "陽金公路.GPX", size: 1024 })).toBeNull();
  });

  test("rejects other extensions", () => {
    expect(validateGpxFile({ name: "route.fit", size: 1024 })).toBe("只能上傳 .gpx 檔案");
  });

  test("rejects empty files", () => {
    expect(validateGpxFile({ name: "a.gpx", size: 0 })).toBe("檔案是空的");
  });

  test("rejects files over the limit", () => {
    expect(validateGpxFile({ name: "a.gpx", size: GPX_MAX_BYTES + 1 })).toBe("檔案超過 5 MB 上限");
    expect(validateGpxFile({ name: "a.gpx", size: GPX_MAX_BYTES })).toBeNull();
  });
});

test("routeNameFromFile strips the extension", () => {
  expect(routeNameFromFile("冷水坑 + 陽金公路.gpx")).toBe("冷水坑 + 陽金公路");
  expect(routeNameFromFile("route.GPX")).toBe("route");
});
