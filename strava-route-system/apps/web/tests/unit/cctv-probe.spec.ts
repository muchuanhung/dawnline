import { test, expect } from "@playwright/test";
import { probeCctvUrl } from "@/lib/cctv/probe.server";

const CAM = "https://cctv.example.gov.tw/cam1";
const JPEG = new Uint8Array([0xff, 0xd8, 1, 2, 3, 0xff, 0xd9]);

const realFetch = globalThis.fetch;
test.afterEach(() => {
  globalThis.fetch = realFetch;
});

/** 依網址回傳假回應，紀錄打過哪些網址 */
function mockFetch(routes: Record<string, () => Response>): string[] {
  const calls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    const make = routes[url];
    if (!make) throw new TypeError("fetch failed");
    return make();
  }) as typeof fetch;
  return calls;
}

/** 無止盡的 MJPEG 串流：同一張影格分兩段送，之後永不結束 */
function mjpegStream(): ReadableStream<Uint8Array> {
  const parts = [
    new TextEncoder().encode("--frame\r\nContent-Type: image/jpeg\r\n\r\n"),
    JPEG.slice(0, 3),
    JPEG.slice(3),
  ];
  return new ReadableStream({
    pull(controller) {
      const next = parts.shift();
      if (next) controller.enqueue(next);
      // 不 close：模擬串流，probe 必須讀到第一張就自己中斷
    },
  });
}

test.describe("probeCctvUrl", () => {
  test("image/jpeg → ok，帶影格 hash", async () => {
    mockFetch({ [CAM]: () => new Response(JPEG, { headers: { "content-type": "image/jpeg" } }) });
    const r = await probeCctvUrl(CAM);
    expect(r.outcome).toBe("ok");
    expect(r.frameHash).toMatch(/^[0-9a-f]{40}$/);
    expect(r.firstFrameMs).toBeGreaterThanOrEqual(0);
  });

  test("MJPEG 讀到第一張 JPEG 就結束，hash 與單張相同", async () => {
    mockFetch({ [CAM]: () => new Response(JPEG, { headers: { "content-type": "image/jpeg" } }) });
    const single = await probeCctvUrl(CAM);
    mockFetch({
      [CAM]: () =>
        new Response(mjpegStream(), { headers: { "content-type": "multipart/x-mixed-replace; boundary=frame" } }),
    });
    const r = await probeCctvUrl(CAM);
    expect(r.outcome).toBe("ok");
    expect(r.frameHash).toBe(single.frameHash);
  });

  test("HLS playlist → ok，不算 hash", async () => {
    mockFetch({
      [CAM]: () =>
        new Response("#EXTM3U\n#EXT-X-VERSION:3\n", { headers: { "content-type": "application/vnd.apple.mpegurl" } }),
    });
    const r = await probeCctvUrl(CAM);
    expect(r.outcome).toBe("ok");
    expect(r.frameHash).toBeUndefined();
  });

  test("HTML 播放頁 → unprobeable", async () => {
    mockFetch({ [CAM]: () => new Response("<html></html>", { headers: { "content-type": "text/html" } }) });
    expect((await probeCctvUrl(CAM)).outcome).toBe("unprobeable");
  });

  test("404、非影像內容、連線錯誤 → fail", async () => {
    mockFetch({ [CAM]: () => new Response("nope", { status: 404 }) });
    expect((await probeCctvUrl(CAM)).outcome).toBe("fail");
    mockFetch({ [CAM]: () => new Response("{}", { headers: { "content-type": "application/json" } }) });
    expect((await probeCctvUrl(CAM)).outcome).toBe("fail");
    mockFetch({});
    expect((await probeCctvUrl(CAM)).outcome).toBe("fail");
  });

  test("401／403／451（拒絕存取、擋地區）→ unprobeable，不算失敗", async () => {
    for (const status of [401, 403, 451]) {
      mockFetch({ [CAM]: () => new Response("denied", { status }) });
      expect((await probeCctvUrl(CAM)).outcome).toBe("unprobeable");
    }
  });

  test("5xx 仍算 fail", async () => {
    mockFetch({ [CAM]: () => new Response("err", { status: 503 }) });
    expect((await probeCctvUrl(CAM)).outcome).toBe("fail");
  });

  test("轉址到內網不跟，回 unprobeable", async () => {
    const calls = mockFetch({
      [CAM]: () => new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest" } }),
    });
    expect((await probeCctvUrl(CAM)).outcome).toBe("unprobeable");
    expect(calls).toEqual([CAM]);
  });

  test("一般轉址會跟", async () => {
    const target = "https://cctv2.example.gov.tw/cam1.jpg";
    mockFetch({
      [CAM]: () => new Response(null, { status: 302, headers: { location: target } }),
      [target]: () => new Response(JPEG, { headers: { "content-type": "image/jpeg" } }),
    });
    expect((await probeCctvUrl(CAM)).outcome).toBe("ok");
  });

  test("已知播放頁網域不發請求", async () => {
    const calls = mockFetch({});
    expect((await probeCctvUrl("https://tw.live/cam/?id=lsktcc")).outcome).toBe("unprobeable");
    expect(calls).toEqual([]);
  });
});
