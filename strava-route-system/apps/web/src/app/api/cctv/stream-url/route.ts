/**
 * 查新北 ATIS 鏡頭的 HTTP-FLV 串流網址
 * GET /api/cctv/stream-url?id=C000236 → { url }
 *
 * ATIS 外框頁禁止內嵌，頁內影像是先呼叫 queryCCTVURL 取得串流網址再播放；這裡在伺服器端代查，
 * 只回傳網址，串流本身由瀏覽器直接向新北主機讀取（不經我們的伺服器轉送）
 */

import { NextResponse } from "next/server";
import { isAtisFlvUrl } from "@/lib/cctv/embed-policy";

const ATIS_QUERY_URL = "https://apiatis.ntpc.gov.tw/atis-api/device/queryCCTVURL";

type AtisQueryResponse = { status?: number; data?: { deviceId?: string; url?: string } };

export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!/^C\d{6}$/.test(id)) {
    return NextResponse.json({ error: "鏡頭 ID 格式錯誤" }, { status: 400 });
  }

  try {
    const res = await fetch(`${ATIS_QUERY_URL}/${id}`, {
      next: { revalidate: 300 }, // 串流網址少變動，快取 5 分鐘
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`ATIS ${res.status}`);
    const body = (await res.json()) as AtisQueryResponse;
    const url = body.data?.url;
    if (!isAtisFlvUrl(url)) throw new Error("ATIS 回傳的串流網址不符預期");
    return NextResponse.json({ url });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[ATIS] ${id} 串流網址查詢失敗：${msg}`);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
