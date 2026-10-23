import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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

export default nextConfig;
