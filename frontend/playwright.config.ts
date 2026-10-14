import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests run against real servers started by Playwright:
 *  - API:      FastAPI on :8000 with a FRESH sqlite database (deleted before start)
 *  - Frontend: Vite dev server on :5173 (proxies /api to :8000, same origin like production)
 *
 * CHROMIUM_PATH (optional): use a specific Chromium binary instead of Playwright's download.
 * CHROMIUM_LIB_DIR (optional): shared libraries directory for that binary.
 */
const CHROMIUM_PATH = process.env.CHROMIUM_PATH || undefined;
const CHROMIUM_LIB_DIR = process.env.CHROMIUM_LIB_DIR;
const API_CMD = process.env.E2E_API_CMD ?? '.venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000';
const E2E_DB = '../backend/zyvora-e2e.db';

export default defineConfig({
  testDir: './e2e',
  testMatch: /auth-session\.spec\.ts/,
  timeout: 240_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  outputDir: 'test-results',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on',
    screenshot: 'only-on-failure',
    launchOptions: {
      executablePath: CHROMIUM_PATH,
      args: CHROMIUM_PATH ? ['--no-sandbox'] : [],
      env: CHROMIUM_LIB_DIR ? { ...process.env, LD_LIBRARY_PATH: CHROMIUM_LIB_DIR } as Record<string, string> : undefined,
    },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      // Fresh database on every run: the file is removed before the API starts.
      command: `rm -f ${E2E_DB} && cd ../backend && DATABASE_URL=sqlite:///./zyvora-e2e.db ENVIRONMENT=development REQUIRE_EMAIL_VERIFICATION=false RATE_LIMIT_PER_MINUTE=1000 ${API_CMD}`,
      url: 'http://localhost:8000/api/health',
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      command: 'npm run dev',
      url: 'http://localhost:5173',
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
  ],
});
