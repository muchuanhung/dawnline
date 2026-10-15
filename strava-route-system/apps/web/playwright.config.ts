import { defineConfig, devices } from "@playwright/test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { AUTH_STATE_PATH } from "./tests/setup/auth-state";

const configDir = dirname(fileURLToPath(import.meta.url));

// 測試帳號（E2E_USER_EMAIL／E2E_USER_PASSWORD）放在 apps/web 或 monorepo 根目錄的 .env.local，
// 兩處都已被 .gitignore 排除；先讀到的值優先，都沒有時 dashboard 測試自動跳過
for (const file of [join(configDir, ".env.local"), join(configDir, "../../.env.local")]) {
  try {
    process.loadEnvFile(file);
  } catch {
    // 檔案不存在就略過
  }
}

/** 只跑 unit 時不需要 server，避免每次都要先 build */
function isUnitOnly(argv: string[]): boolean {
  const projects: string[] = [];
  argv.forEach((arg, i) => {
    if (arg.startsWith("--project=")) projects.push(arg.slice("--project=".length));
    else if (arg === "--project" && argv[i + 1]) projects.push(argv[i + 1]!);
  });
  return projects.length > 0 && projects.every((p) => p === "unit");
}

// E2E 測 production build：dev server 同時服務多個瀏覽器時送 JS 太慢且會中途重新編譯，
// 平行測試會超時。用 3100 port，不影響開著的 pnpm dev（3000）。
// 直接呼叫 next build。
const PORT = 3100;

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  reporter: [["list"], ["html", { open: "never" }]],
  expect: { timeout: 10_000 },
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [
    // 純函式，不開瀏覽器
    { name: "unit", testDir: "./tests/unit" },
    {
      name: "e2e-desktop",
      testDir: "./tests/e2e",
      testIgnore: /dashboard/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "e2e-mobile",
      testDir: "./tests/e2e",
      testIgnore: /dashboard/,
      use: { ...devices["Pixel 7"] },
    },
    // 需要 .env.local 的測試帳號；未設定時整組跳過
    { name: "auth-setup", testDir: "./tests/setup", testMatch: /auth\.setup\.ts/ },
    // Dashboard 在伺服器端解析 GPX、反查行政區、抓天氣與路況，快取未建立時很吃 CPU；
    // 與其他 E2E 同時跑會互相拖慢到逾時，因此排在最後：
    // 桌機／手機 → dashboard。單獨跑 dashboard 可加 --no-deps 跳過前面的組
    {
      name: "e2e-dashboard",
      testDir: "./tests/e2e",
      testMatch: /dashboard/,
      dependencies: ["auth-setup", "e2e-desktop", "e2e-mobile"],
      use: { ...devices["Desktop Chrome"], storageState: AUTH_STATE_PATH },
    },
  ],
  webServer: isUnitOnly(process.argv)
    ? undefined
    : {
        command: `pnpm exec next build && pnpm exec next start --port ${PORT}`,
        url: `http://localhost:${PORT}`,
        // 每次都重新 build，避免測到舊版本
        reuseExistingServer: false,
        timeout: 300_000,
      },
});
