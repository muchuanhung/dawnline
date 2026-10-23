import { test, expect } from "@playwright/test";
import { freshInputs, inputId, INPUT_MAX_AGE_MS, type StoredInput } from "@/lib/dashboard/briefing-inputs";

const NOW = Date.parse("2026-10-22T14:00:00+08:00");
const doc = (data: unknown, ageMs: number): StoredInput => ({ json: JSON.stringify(data), fetchedAt: NOW - ageMs });

test.describe("判讀輸入新鮮度", () => {
  test("id 依種類加前綴", () => {
    expect(inputId("weather", "臺北市|士林區")).toBe("weather:臺北市|士林區");
    expect(inputId("tdx", "臺北市")).toBe("tdx:臺北市");
  });

  test("期限內的輸入直接採用並解析 JSON", () => {
    const stored = new Map([["rain:臺北市", doc([{ mmPerHr: 1.5 }], 60_000)]]);
    const { fresh, missing } = freshInputs(stored, ["rain:臺北市"], NOW);
    expect(fresh.get("rain:臺北市")).toEqual([{ mmPerHr: 1.5 }]);
    expect(missing).toEqual([]);
  });

  test("沒有文件、過期、JSON 壞掉都要重抓，不可當成沒有資料", () => {
    const stored = new Map<string, StoredInput>([
      ["tdx:臺北市", doc([], INPUT_MAX_AGE_MS + 1)],
      ["tdx:新北市", { json: "{bad", fetchedAt: NOW }],
    ]);
    const { fresh, missing } = freshInputs(stored, ["tdx:臺北市", "tdx:新北市", "tdx:基隆市"], NOW);
    expect(fresh.size).toBe(0);
    expect(missing).toEqual(["tdx:臺北市", "tdx:新北市", "tdx:基隆市"]);
  });

  test("剛好在期限內仍可用；抓取時間在未來超過 1 分鐘不信任", () => {
    const stored = new Map([
      ["weather:a", doc({ t: 1 }, INPUT_MAX_AGE_MS)],
      ["weather:b", doc({ t: 2 }, -120_000)],
    ]);
    const { fresh, missing } = freshInputs(stored, ["weather:a", "weather:b"], NOW);
    expect([...fresh.keys()]).toEqual(["weather:a"]);
    expect(missing).toEqual(["weather:b"]);
  });

  test("空的事件清單也是有效資料（該縣市目前沒有事件）", () => {
    const stored = new Map([["tdx:宜蘭縣", doc([], 1000)]]);
    const { fresh } = freshInputs(stored, ["tdx:宜蘭縣"], NOW);
    expect(fresh.get("tdx:宜蘭縣")).toEqual([]);
  });
});
