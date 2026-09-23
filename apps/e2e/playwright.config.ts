import { defineConfig, devices } from "@playwright/test";

const API_PORT = 3410;
const WEB_PORT = 3401;
const DATABASE_URL =
  process.env.E2E_DATABASE_URL ?? "postgres://thoroughline:thoroughline@localhost:5432/thoroughline_e2e";

/**
 * End-to-end journeys through the exported Mini App against the real API (dev auth, job runner
 * on, real Postgres). Build first: `pnpm build` and `pnpm --filter @thoroughline/e2e build:web`.
 */
export default defineConfig({
  testDir: "tests",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: true,
  workers: process.env.CI ? 2 : 4,
  retries: 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    ...devices["Pixel 7"],
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
  },
  webServer: [
    {
      command: "node ../api/dist/main.js",
      url: `http://localhost:${API_PORT}/health`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        NODE_ENV: "development",
        PORT: String(API_PORT),
        DATABASE_URL,
        JWT_SECRET: "e2e-only-secret-e2e-only-secret-e2e-only",
        RACE_SEED_SECRET: "e2e-only-race-seed-secret-e2e-only-0000",
        ALLOW_DEV_AUTH: "true",
        JOB_RUNNER: "true",
        LOG_LEVEL: "warn",
        // Every browser shares one client IP here.
        RATE_LIMIT_SCALE: "20",
        CORS_ORIGINS: `http://localhost:${WEB_PORT}`,
      },
    },
    {
      command: `node serve.mjs ../web/out ${WEB_PORT}`,
      url: `http://localhost:${WEB_PORT}/`,
      reuseExistingServer: false,
    },
  ],
});
