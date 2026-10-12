import { test, expect } from "@playwright/test";
import {
  appendProbeAttempt,
  applyProbeStatuses,
  classifyProbeHistory,
  isProbeFresh,
  isProbeableUrl,
  PROBE_CACHE_MS,
  PROBE_STALE_MS,
  type ProbeAttempt,
} from "@/lib/cctv/probe-status";

const NOW = 1_700_000_000_000;
const MIN = 60_000;

function ok(minutesAgo: number, extra: Partial<ProbeAttempt> = {}): ProbeAttempt {
  return { at: NOW - minutesAgo * MIN, outcome: "ok", firstFrameMs: 800, ...extra };
}
function fail(minutesAgo: number): ProbeAttempt {
  return { at: NOW - minutesAgo * MIN, outcome: "fail" };
}

test.describe("classifyProbeHistory：unknown", () => {
  test("沒探測過 → unknown", () => {
    expect(classifyProbeHistory([], NOW)).toBe("unknown");
  });

  test("最新紀錄超過 10 分鐘，即使當時成功也是 unknown", () => {
    expect(classifyProbeHistory([{ ...ok(0), at: NOW - PROBE_STALE_MS - 1 }], NOW)).toBe("unknown");
  });

  test("無法探測的來源（HTML 播放頁）→ unknown", () => {
    expect(classifyProbeHistory([{ at: NOW, outcome: "unprobeable" }], NOW)).toBe("unknown");
  });

  test("只失敗 1 次 → unknown，不直接判離線", () => {
    expect(classifyProbeHistory([fail(0)], NOW)).toBe("unknown");
    expect(classifyProbeHistory([fail(0), ok(5)], NOW)).toBe("unknown");
  });
});

test.describe("classifyProbeHistory：offline", () => {
  test("連續 2 次失敗 → offline", () => {
    expect(classifyProbeHistory([fail(0), fail(5)], NOW)).toBe("offline");
  });

  test("輸入順序打亂也依時間判斷", () => {
    expect(classifyProbeHistory([fail(5), fail(0)], NOW)).toBe("offline");
  });
});

test.describe("classifyProbeHistory：online / degraded", () => {
  test("最近成功、影格快、沒有失敗 → online", () => {
    expect(classifyProbeHistory([ok(0, { frameHash: "a" }), ok(5, { frameHash: "b" })], NOW)).toBe("online");
  });

  test("第一個影格超過 3 秒 → degraded", () => {
    expect(classifyProbeHistory([ok(0, { firstFrameMs: 3_500 })], NOW)).toBe("degraded");
  });

  test("剛好 3 秒仍算 online", () => {
    expect(classifyProbeHistory([ok(0, { firstFrameMs: 3_000 })], NOW)).toBe("online");
  });

  test("最近 3 次有 1 次失敗 → degraded", () => {
    expect(classifyProbeHistory([ok(0), fail(5), ok(10)], NOW)).toBe("degraded");
  });

  test("超過 3 筆的舊失敗不算", () => {
    expect(classifyProbeHistory([ok(0), ok(5), ok(10), fail(15)], NOW)).toBe("online");
  });

  test("連兩次影格 hash 相同（畫面凍結）→ degraded", () => {
    expect(classifyProbeHistory([ok(0, { frameHash: "x" }), ok(5, { frameHash: "x" })], NOW)).toBe("degraded");
  });

  test("HLS 沒有 hash，不判凍結", () => {
    expect(classifyProbeHistory([ok(0), ok(5)], NOW)).toBe("online");
  });
});

test.describe("appendProbeAttempt / isProbeFresh", () => {
  test("新紀錄在最前面，只保留 3 筆", () => {
    const next = appendProbeAttempt([ok(5), ok(10), ok(15)], fail(0));
    expect(next).toHaveLength(3);
    expect(next[0]?.outcome).toBe("fail");
    expect(next[2]?.at).toBe(NOW - 10 * MIN);
  });

  test("5 分鐘內探測過就用快取", () => {
    expect(isProbeFresh([{ ...ok(0), at: NOW - PROBE_CACHE_MS + 1 }], NOW)).toBe(true);
    expect(isProbeFresh([{ ...ok(0), at: NOW - PROBE_CACHE_MS }], NOW)).toBe(false);
    expect(isProbeFresh([], NOW)).toBe(false);
  });
});

test.describe("isProbeableUrl", () => {
  test("一般 http(s) 影像網址可探測", () => {
    expect(isProbeableUrl("https://cctv.example.gov.tw/stream.mjpg")).toBe(true);
    expect(isProbeableUrl("http://61.60.10.1/cam1.jpg")).toBe(true);
  });

  test("已知 HTML 播放頁不探測", () => {
    expect(isProbeableUrl("https://tw.live/cam/?id=lsktcc")).toBe(false);
    expect(isProbeableUrl("https://hls.bote.gov.taipei/live/index.html?id=236")).toBe(false);
  });

  test("空值、非 http、內網位址不探測", () => {
    expect(isProbeableUrl(undefined)).toBe(false);
    expect(isProbeableUrl("not a url")).toBe(false);
    expect(isProbeableUrl("ftp://example.com/a.jpg")).toBe(false);
    expect(isProbeableUrl("http://localhost:3000/x")).toBe(false);
    expect(isProbeableUrl("http://127.0.0.1/x")).toBe(false);
    expect(isProbeableUrl("http://10.1.2.3/x")).toBe(false);
    expect(isProbeableUrl("http://169.254.169.254/latest/meta-data")).toBe(false);
    expect(isProbeableUrl("http://192.168.0.1/x")).toBe(false);
    expect(isProbeableUrl("http://[::1]/x")).toBe(false);
  });
});

test.describe("applyProbeStatuses", () => {
  const feeds = [
    { id: "a", status: "unknown" as const },
    { id: "b", status: "unknown" as const },
    { id: "c", status: "unknown" as const },
  ];

  test("套用回傳的狀態，沒回傳或不合法的維持 unknown", () => {
    const next = applyProbeStatuses(feeds, { a: "online", b: "bogus" });
    expect(next.map((f) => f.status)).toEqual(["online", "unknown", "unknown"]);
  });

  test("狀態沒變時保留原物件", () => {
    const next = applyProbeStatuses(feeds, { a: "unknown" });
    expect(next[0]).toBe(feeds[0]);
  });
});
