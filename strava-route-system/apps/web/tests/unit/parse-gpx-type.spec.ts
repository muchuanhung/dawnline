import { test, expect } from "@playwright/test";
import { parseGpxType } from "@/lib/routes/parse-gpx";

/** Same cases as backend tests/test_routes.py test_route_type_follows_frontend_rules */
const gpx = (meta: string) => `<?xml version="1.0"?><gpx><trk>${meta}<trkseg></trkseg></trk></gpx>`;

test.describe("路線類型判斷（parseGpxType）", () => {
  const cases: [string, string, string][] = [
    ["", "陽金公路", "自行車"],
    ["<type>hike</type>", "七星山", "健行"],
    ["<type>hiking</type>", "七星山", "健行"],
    ["<type>Hiking</type>", "七星山", "健行"],
    ["<type>walking</type>", "河濱", "健行"],
    ["<type>running</type>", "晨跑", "跑步"],
    ["<type>trail_run</type>", "越野", "健行"],
    ["<type>cycling</type>", "YMS 雪巴 Day 1", "雪巴運動"],
    ["<desc>Peaks of Taiwan</desc>", "day2", "雪巴運動"],
  ];
  for (const [meta, routeId, expected] of cases) {
    test(`${meta || "（無 type）"} → ${expected}`, () => {
      expect(parseGpxType(gpx(meta), routeId)).toBe(expected);
    });
  }
});
