import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 120000,
  use: {
    channel: "msedge",
    headless: true,
    viewport: { width: 1280, height: 900 },
    baseURL: "http://127.0.0.1:1430",
    screenshot: "only-on-failure",
  },
  webServer: {
    command:
      "node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 1430 --strictPort",
    url: "http://127.0.0.1:1430/tests/editor.html",
    reuseExistingServer: process.env.PW_REUSE_SERVER === "1",
  },
  reporter: "list",
});
