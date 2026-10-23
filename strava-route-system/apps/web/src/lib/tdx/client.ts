/**
 * TDX 運輸資料流通服務 API 客戶端
 *
 * ## 用途
 * 從 TDX 取得全台道路 CCTV 經緯度與串流網址，供 Firestore 儲存、後續 GeoQuery 查詢路線附近監視器。
 *
 * ## 資料流程
 * 1. getAccessToken()：OIDC Client Credentials 取得 Bearer token（記憶體快取，避免重複請求）
 * 2. fetchCCTVByCity(code)：依縣市代碼呼叫 TDX v2 API，回傳 CCTVs 陣列
 * 3. fetchAllCCTV(cities)：遍歷縣市、節流 500ms、合併結果，每筆附加 _county
 *
 * ## 錯誤處理
 * - 404：API 路徑變更，回傳 [] 不中斷
 * - 429：rate limit，等 5 秒重試一次，仍失敗則回傳 []
 * - 其他：throw，由上層 catch
 *
 *
 */

import { normalizeCountyForCWB } from "@/lib/cwb/county-map";
import { reportError, reportFailureRate } from "@/lib/observability/report";

const TOKEN_URL ="https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token";
const CCTV_BASE = "https://tdx.transportdata.tw/api/basic/v2/Road/Traffic/CCTV";

/** TDX v2 API 回傳格式 */
export type TDXCCTVItem = {
  CCTVID?: string;
  VideoStreamURL?: string;
  PositionLat?: number;
  PositionLon?: number;
  RoadName?: string;
  RoadID?: string;
  RoadClass?: number;
  RoadDirection?: string;
  LinkID?: string;
  LocationType?: number;
  SurveillanceType?: number;
  CCTVId?: string;
  Position?: { PositionLat?: number; PositionLon?: number };
  Link?: { Url?: string };
  VideoUrl?: string;
  VideoSrcUrl?: string;
  [key: string]: unknown;
};

/** TDX v2 回傳包裝 */
type TDXCCTVResponse = { CCTVs?: TDXCCTVItem[] };

let cachedToken: { token: string; expiresAt: number } | null = null;

/** OIDC Client Credentials，token 快取至過期前 1 分鐘（CCTV 與路況事件共用） */
export async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60000) {
    return cachedToken.token;
  }
  const clientId = process.env.TDX_CLIENT_ID;
  const clientSecret = process.env.TDX_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("TDX_CLIENT_ID 與 TDX_CLIENT_SECRET 未設定");
  }
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
  });
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
    next: { revalidate: 0 },
    // 網路卡住時快速失敗，避免拖住呼叫端（Dashboard 判讀、CCTV 同步）
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`TDX Token 取得失敗: ${res.status} ${text}`);
  }
  const data = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in ?? 86400) * 1000,
  };
  return cachedToken.token;
}

/** TDX 縣市代碼對照（用於 CCTV City 查詢） */
export const TDX_CITY_CODES: Record<string, string> = {
  台北市: "Taipei",
  新北市: "NewTaipei",
  基隆市: "Keelung",
  桃園市: "Taoyuan",
  新竹市: "Hsinchu",
  新竹縣: "HsinchuCounty",
  苗栗縣: "MiaoliCounty",
  臺中市: "Taichung",
  彰化縣: "ChanghuaCounty",
  南投縣: "NantouCounty",
  雲林縣: "YunlinCounty",
  嘉義市: "Chiayi",
  嘉義縣: "ChiayiCounty",
  臺南市: "Tainan",
  高雄市: "Kaohsiung",
  屏東縣: "PingtungCounty",
  宜蘭縣: "YilanCounty",
  花蓮縣: "HualienCounty",
  臺東縣: "TaitungCounty",
  澎湖縣: "PenghuCounty",
  金門縣: "KinmenCounty",
  連江縣: "LienchiangCounty",
};

export const TDX_SYNC_CITIES = Object.keys(TDX_CITY_CODES) as (keyof typeof TDX_CITY_CODES)[];

/** 路段縣市名（可能是 1982 年舊名，如「台北縣」）→ TDX 縣市代碼；查無回傳 null */
export function tdxCityCode(county: string): string | null {
  const name = normalizeCountyForCWB(county);
  const hit = Object.entries(TDX_CITY_CODES).find(([k]) => k.replace(/台/g, "臺") === name);
  return hit?.[1] ?? null;
}

/**
 * 取得單一縣市 CCTV（TDX v2：/City/{code}?$top=1000&$format=JSON）
 * 回傳 CCTVs 陣列，欄位含 CCTVID、VideoStreamURL、PositionLat/Lon、RoadName
 */
export async function fetchCCTVByCity(cityCode: string): Promise<TDXCCTVItem[]> {
  const token = await getAccessToken();
  const params = new URLSearchParams({ $top: "1000", $format: "JSON" });
  const url = `${CCTV_BASE}/City/${cityCode}?${params}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Accept-Encoding": "gzip, br",
    },
    next: { revalidate: 0 },
  });
  if (!res.ok) {
    if (res.status === 404) {
      console.warn(`[TDX] CCTV API 路徑可能已變更: ${url}`);
      return [];
    }
    if (res.status === 429) {
      console.warn(`[TDX] 速率限制 ${cityCode}，等候 5 秒後重試`);
      await new Promise((r) => setTimeout(r, 5000));
      const retry = await fetch(url, {
        headers: { Authorization: `Bearer ${token}`, "Accept-Encoding": "gzip, br" },
        next: { revalidate: 0 },
      });
      if (!retry.ok) {
        console.warn(`[TDX] 重試後仍失敗 ${cityCode}: ${retry.status}`);
        return [];
      }
      const retryData = (await retry.json()) as TDXCCTVResponse;
      return retryData?.CCTVs ?? [];
    }
    const text = await res.text();
    throw new Error(`TDX CCTV 取得失敗 ${cityCode}: ${res.status} ${text}`);
  }
  const data = (await res.json()) as TDXCCTVResponse;
  return data?.CCTVs ?? [];
}

/**
 * 依縣市逐一呼叫 TDX，合併結果。每筆附加 _county 供 Firestore 寫入。
 * 縣市間 delay 500ms 避免 429。
 */
export async function fetchAllCCTV(cities?: string[]): Promise<TDXCCTVItem[]> {
  const cityList = cities ?? Object.keys(TDX_CITY_CODES);
  const all: TDXCCTVItem[] = [];
  let attempted = 0;
  let ok = 0;
  for (const cityZh of cityList) {
    const code = TDX_CITY_CODES[cityZh];
    if (!code) continue;
    attempted += 1;
    try {
      const items = await fetchCCTVByCity(code);
      all.push(...items.map((i) => ({ ...i, _county: cityZh })));
      ok += 1;
    } catch (e) {
      reportError("tdx", "cctv-city-failed", e, { county: cityZh });
    }
    await new Promise((r) => setTimeout(r, 500)); // 節流避免 rate limit
  }
  // 每日同步只跑一次，失敗率要在這裡看；少數縣市失敗可以接受，整批失敗代表金鑰或 API 變更
  reportFailureRate("tdx", "cctv-sync-degraded", ok, attempted, { threshold: 0.3 });
  return all;
}

