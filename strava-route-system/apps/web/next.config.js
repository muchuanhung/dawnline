import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { withSentryConfig } from "@sentry/nextjs/config";

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, ".env.local");
if (existsSync(envPath) && !process.env.CWB_API_KEY) {
  const content = readFileSync(envPath, "utf8");
  for (const line of content.split("\n")) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) {
      const key = m[1].trim();
      const val = m[2].trim();
      if (!process.env[key]) process.env[key] = val;
    }
  }
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  async headers() {
    return [
      {
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Service-Worker-Allowed', value: '/' },
        ],
      },
    ];
  },
  async rewrites() {
    // FastAPI 後端（AWS）：/api/v1/* 經 Vercel 轉過去，rc_session 才是同站 cookie。
    // 未設定 BACKEND_API_URL 時不轉，私人路線 API 會 404。
    const backend = process.env.BACKEND_API_URL?.replace(/\/+$/, '');
    return [
      ...(backend ? [{ source: '/api/v1/:path*', destination: `${backend}/api/v1/:path*` }] : []),
    ];
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**.cloudfront.net',
      },
    ],
  },
};

// Sentry 建置選項。沒有 SENTRY_AUTH_TOKEN 時不上傳 source map，建置照常通過（錯誤堆疊會是壓縮後的樣子）。
// 執行期有沒有送資料由 NEXT_PUBLIC_SENTRY_DSN 決定，見 src/lib/observability/sentry-options.ts。
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !process.env.CI,
  telemetry: false,
  widenClientFileUpload: true,
  sourcemaps: {
    disable: !process.env.SENTRY_AUTH_TOKEN,
    deleteSourcemapsAfterUpload: true,
  },
  // 不要自動包住伺服器端依賴；只用 onRequestError、瀏覽器錯誤與 reportError 手動回報
  buildTimeInstrumentation: false,
  // 沒用到效能追蹤與 Replay，把相關程式碼從 bundle 拿掉（手機探索頁效能本來就是已知問題）
  bundleSizeOptimizations: {
    excludeDebugStatements: true,
    excludeTracing: true,
    excludeReplayIframe: true,
    excludeReplayShadowDom: true,
    excludeReplayWorker: true,
  },
});
