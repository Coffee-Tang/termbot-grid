import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30000,
  retries: 0,
  use: {
    browserName: 'chromium',
    headless: true,
    viewport: { width: 1200, height: 800 },
  },
});
