import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  use: {
    baseURL: "http://127.0.0.1:1420",
    viewport: { width: 1240, height: 840 },
    headless: process.env.COCO_TEST_HEADED !== "1",
    launchOptions: { executablePath: process.env.COCO_TEST_BROWSER },
  },
  webServer: {
    command: "npm run dev",
    url: "http://127.0.0.1:1420",
    reuseExistingServer: !process.env.CI,
  },
  reporter: "list",
});
