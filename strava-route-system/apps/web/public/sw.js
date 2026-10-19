/**
 * Service Worker：PWA 安裝＋離線快照
 *
 * - 安裝時預快取首頁、登入頁、圖示
 * - /_next/static/*：cache-first（檔名含 hash，內容不會變）
 * - /routes 頁面與路線頁用的 3 支 API：network-first，網路失敗才回快取（離線快照）
 *   寫入快照時加上 SNAPSHOT_HEADER（存檔時間，epoch ms），前端據此標示資料時間與套用過期規則
 *   （規則在 src/lib/routes/snapshot.ts；標頭名稱兩邊必須一致）
 * - 私人路線（我的路線列表、詳情頁與它用的 API）同樣 network-first，但存在 PRIVATE_CACHE，
 *   登出時由 AuthContext 整個刪掉，換人登入不會看到上一位的路線
 * - 只快取線上看過的路線，不主動下載
 */
const CACHE_NAME = "dawnline-v3";
const STATIC_CACHE = "dawnline-static-v1";
const SNAPSHOT_CACHE = "dawnline-snapshot-v1";
/** 名稱需與 src/lib/routes/snapshot.ts 的 PRIVATE_SNAPSHOT_CACHE 一致（登出時刪除） */
const PRIVATE_CACHE = "dawnline-private-v1";
const KEEP_CACHES = [CACHE_NAME, STATIC_CACHE, SNAPSHOT_CACHE, PRIVATE_CACHE];

const SNAPSHOT_HEADER = "x-dawnline-snapshot-at";
/** 安裝時預快取；離線時以路徑比對回傳（忽略 ?v= 等版本參數） */
const PRECACHE_PATHS = ["/", "/login", "/manifest.json", "/icon.svg", "/dawnline.svg", "/icons/icon-192.png", "/icons/icon-512.png"];
/** 快照與靜態檔各自最多保留幾筆，超過刪最舊的（Cache API 的 keys() 依寫入順序） */
const MAX_SNAPSHOTS = 40;
const MAX_STATIC = 300;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_PATHS).catch(() => {}))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => !KEEP_CACHES.includes(k)).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirst(request));
    return;
  }
  const key = snapshotKey(request, url);
  if (key) {
    event.respondWith(networkFirst(request, key, SNAPSHOT_CACHE));
    return;
  }
  const privateKey = privateSnapshotKey(request, url);
  if (privateKey) {
    event.respondWith(networkFirst(request, privateKey, PRIVATE_CACHE));
    return;
  }
  // 預快取的頁面與圖示（例如導覽列 logo）：照常走網路，離線才用預快取
  if (PRECACHE_PATHS.includes(url.pathname)) event.respondWith(precacheFallback(request, url));
});

async function precacheFallback(request, url) {
  try {
    return await fetch(request);
  } catch (err) {
    const cached = await caches.match(url.pathname, { cacheName: CACHE_NAME });
    if (cached) return cached;
    throw err;
  }
}

/**
 * 需要離線快照的請求 → 快取鍵；其他請求回傳 null（不攔截）
 * - /routes 頁面：鍵只留路徑，換路線（?route=）共用同一份外殼，路線由前端讀網址決定
 * - 判讀：去掉 from（途中模式每 0.5 km 變一次），留 route／depart／activity
 */
function snapshotKey(request, url) {
  if (request.mode === "navigate") {
    return url.pathname === "/routes" ? new URL("/routes", url.origin).href : null;
  }
  if (url.pathname === "/api/routes/gpx") return new URL(url.pathname, url.origin).href;
  if (url.pathname === "/api/cctv/near-route") return url.href;
  if (url.pathname === "/api/routes/briefing") return briefingKey(url);
  return null;
}

/**
 * 私人路線的快取鍵（存 PRIVATE_CACHE）
 * - 我的路線頁（/routes/private，桌機 ?route= 共用外殼）與詳情頁（/routes/private/<id>）：鍵只留路徑
 * - 路線列表（/api/v1/routes）、解析後的路線（/api/routes/private?route=）、判讀（規則同公開判讀）
 */
function privateSnapshotKey(request, url) {
  if (request.mode === "navigate") {
    return url.pathname === "/routes/private" || url.pathname.startsWith("/routes/private/")
      ? new URL(url.pathname, url.origin).href
      : null;
  }
  if (url.pathname === "/api/v1/routes") return new URL(url.pathname, url.origin).href;
  if (url.pathname === "/api/routes/private") return url.href;
  if (url.pathname === "/api/routes/private/briefing") return briefingKey(url);
  return null;
}

/** 判讀：去掉 from（途中模式每 0.5 km 變一次），參數排序後當鍵 */
function briefingKey(url) {
  const keyUrl = new URL(url.href);
  keyUrl.searchParams.delete("from");
  keyUrl.searchParams.sort();
  return keyUrl.href;
}

async function networkFirst(request, key, cacheName) {
  try {
    const res = await fetch(request);
    // 只存成功的回應；錯誤回應照常交給頁面處理，不覆蓋舊快照
    if (res.ok) await saveSnapshot(key, res.clone(), cacheName);
    return res;
  } catch (err) {
    const cached = await caches.match(key, { cacheName });
    if (cached) return cached;
    throw err;
  }
}

/** 複製回應並加上存檔時間標頭（原回應的標頭不可改） */
async function saveSnapshot(key, res, cacheName) {
  try {
    const headers = new Headers(res.headers);
    headers.set(SNAPSHOT_HEADER, String(Date.now()));
    const body = await res.blob();
    const cache = await caches.open(cacheName);
    // 先刪再寫，讓剛看過的路線排到最後，裁切時不會被刪
    await cache.delete(key);
    await cache.put(key, new Response(body, { status: res.status, statusText: res.statusText, headers }));
    await trimCache(cache, MAX_SNAPSHOTS);
  } catch {
    // quota exceeded 等：快照失敗不影響線上使用
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request, { cacheName: STATIC_CACHE });
  if (cached) return cached;
  const res = await fetch(request);
  if (res.ok) {
    const copy = res.clone();
    caches.open(STATIC_CACHE)
      .then((cache) => cache.put(request, copy).then(() => trimCache(cache, MAX_STATIC)))
      .catch(() => {});
  }
  return res;
}

async function trimCache(cache, max) {
  const keys = await cache.keys();
  await Promise.all(keys.slice(0, Math.max(0, keys.length - max)).map((k) => cache.delete(k)));
}
