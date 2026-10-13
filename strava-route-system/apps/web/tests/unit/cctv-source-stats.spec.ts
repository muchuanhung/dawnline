import { test, expect } from "@playwright/test";
import { summarizeCctvSources } from "@/lib/cctv/source-stats";

test.describe("summarizeCctvSources", () => {
  const stats = summarizeCctvSources([
    { videoUrl: "https://hls.bote.gov.taipei/live/index.html?id=1", county: "臺北市" },
    { videoUrl: "https://hls.bote.gov.taipei/live/index.html?id=2", county: "臺北市" },
    { videoUrl: "https://cctv.example.gov.tw/cam/1.mjpg", county: "新竹縣" },
    { videoUrl: "", county: "新竹縣" },
    { videoUrl: "not a url" },
  ]);

  test("依網域分組，次數多的排前面，並標出可否探測", () => {
    expect(stats.byHost[0]).toMatchObject({ host: "hls.bote.gov.taipei", count: 2, probeable: false, looksLikeMedia: 0 });
    expect(stats.byHost[1]).toMatchObject({ host: "cctv.example.gov.tw", count: 1, probeable: true, looksLikeMedia: 1 });
  });

  test("沒有或無效網址另外計數", () => {
    expect(stats.total).toBe(5);
    expect(stats.missingUrl).toBe(2);
  });

  test("依縣市統計可探測數，沒有縣市歸為未知", () => {
    expect(stats.byCounty).toContainEqual({ county: "臺北市", total: 2, probeable: 0 });
    expect(stats.byCounty).toContainEqual({ county: "新竹縣", total: 2, probeable: 1 });
    expect(stats.byCounty).toContainEqual({ county: "未知", total: 1, probeable: 0 });
  });
});
