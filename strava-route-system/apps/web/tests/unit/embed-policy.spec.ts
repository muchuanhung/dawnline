import { test, expect } from "@playwright/test";
import { atisCctvId, isAtisFlvUrl, isBlockedByCSP } from "@/lib/cctv/embed-policy";

test.describe("新北 ATIS 鏡頭", () => {
  test("從外框頁網址取出鏡頭 ID", () => {
    expect(atisCctvId("https://atis.ntpc.gov.tw/ATIS/ShowFrame4CCTV/C000236")).toBe("C000236");
    expect(atisCctvId("https://atis.ntpc.gov.tw/ATIS/ShowFrame4CCTV/c000236/")).toBe("C000236");
  });

  test("非 ATIS 或格式不符時回傳 null", () => {
    expect(atisCctvId(undefined)).toBeNull();
    expect(atisCctvId("https://tw.live/cam/?id=lsktcc")).toBeNull();
    expect(atisCctvId("https://atis.ntpc.gov.tw/ATIS/Other/C000236")).toBeNull();
    expect(atisCctvId("https://evil.example/ShowFrame4CCTV/C000236")).toBeNull();
  });

  test("ATIS 外框頁仍屬於禁止 iframe 內嵌的來源", () => {
    expect(isBlockedByCSP("https://atis.ntpc.gov.tw/ATIS/ShowFrame4CCTV/C000236")).toBe(true);
  });

  test("只接受新北 CCTV 主機的 https FLV 串流", () => {
    expect(isAtisFlvUrl("https://cctvatis4.ntpc.gov.tw/flv/C000236")).toBe(true);
    expect(isAtisFlvUrl("http://cctvatis4.ntpc.gov.tw/flv/C000236")).toBe(false);
    expect(isAtisFlvUrl("https://cctvatis4.ntpc.gov.tw.evil.example/flv/C000236")).toBe(false);
    expect(isAtisFlvUrl("https://cctvatis4.ntpc.gov.tw/other/C000236")).toBe(false);
    expect(isAtisFlvUrl(undefined)).toBe(false);
  });
});
