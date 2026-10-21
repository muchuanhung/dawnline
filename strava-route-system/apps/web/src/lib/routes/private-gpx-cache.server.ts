/**
 * 私人路線解析後 GPX 的快取（Next Data Cache）：讀 S3 與行政區取樣只在第一次做。
 * 與 private-route.server.ts 分開，讓 loadPrivateRoute 在單元測試裡不依賴 Next 執行環境。
 */

import { unstable_cache } from "next/cache";
import type { ParsedGpxCache } from "@/lib/routes/private-route.server";

/** GPX 內容不會變，快取一天只是讓久未使用的路線自然淘汰 */
const PARSED_GPX_SECONDS = 86400;

export const cachedParsedGpx: ParsedGpxCache = (routeId, load) =>
  unstable_cache(load, ["private-gpx-v1", routeId], { revalidate: PARSED_GPX_SECONDS })();
