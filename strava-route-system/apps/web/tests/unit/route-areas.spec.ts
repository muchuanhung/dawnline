import { test, expect } from "@playwright/test";
import { formatRouteAreas, routeAreas } from "@/lib/routes/route-areas";

test.describe("路線經過的縣市與行政區", () => {
  test("依經過順序歸到縣市，重複經過只列一次", () => {
    const areas = routeAreas([
      { county: "臺北市", districtZh: "北投區" },
      { county: "臺北市", districtZh: "士林區" },
      { county: "新北市", districtZh: "淡水區" },
      { county: "臺北市", districtZh: "北投區" },
      { county: "新北市", districtZh: "三芝區" },
    ]);
    expect(areas).toEqual([
      { county: "臺北市", districts: ["北投區", "士林區"] },
      { county: "新北市", districts: ["淡水區", "三芝區"] },
    ]);
    expect(formatRouteAreas(areas)).toBe("臺北市 北投區、士林區・新北市 淡水區、三芝區");
  });

  test("沒有縣市或行政區的路段略過；全部沒有時回空字串", () => {
    expect(routeAreas([{ county: undefined, districtZh: "北投區" }, { county: "臺北市", districtZh: "" }])).toEqual([]);
    expect(formatRouteAreas([])).toBe("");
  });
});
