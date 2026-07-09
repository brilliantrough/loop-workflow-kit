import { defineConfig, devices } from "@playwright/test"

export default defineConfig({
  fullyParallel: true,
  testDir: "./tests",
  testMatch: "**/*.e2e.ts",
  use: {
    baseURL: "http://127.0.0.1:4194",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "bun run build && bun run start -- --runs-root tests/fixtures/runs --port 4194 --stale-ms 60000",
    reuseExistingServer: true,
    timeout: 120_000,
    url: "http://127.0.0.1:4194/api/health",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { height: 1000, width: 1440 } } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
})
