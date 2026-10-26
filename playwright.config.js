const { defineConfig } = require("@playwright/test");
module.exports = defineConfig({
  testDir: "./tests/ui",
  timeout: 30000,
  fullyParallel: false,
  workers: 1,
  outputDir: "/tmp/control-panel-optimize-results",
  use: {
    baseURL: "http://127.0.0.1:19431",
    viewport: { width: 1440, height: 1000 },
    launchOptions: process.env.PLAYWRIGHT_CHROME_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROME_PATH }
      : {},
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "node tests/ui/server.cjs",
    url: "http://127.0.0.1:19431/health",
    reuseExistingServer: false,
  },
});
