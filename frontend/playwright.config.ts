import { defineConfig } from "@playwright/test";

// E2E server = production shape: uvicorn serving the prebuilt dist/ with a
// scratch DB (port 8021 so it never collides with a dev stack on 8000/5173).
// Run `npm run build` beforehand; browsers via `npx playwright install chromium`.
const PORT = 8021;

export default defineConfig({
  testDir: "./e2e",
  timeout: 45_000,
  retries: 0,
  workers: 1,
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    headless: true,
    trace: "retain-on-failure",
  },
  webServer: {
    command:
      `RESEARCHMAP_STATIC=$PWD/dist ` +
      `RESEARCHMAP_DB=/tmp/rm-e2e/data.db ` +
      `RESEARCHMAP_TOKENS='{"e2e":"e2e-test-token-0001"}' ` +
      `../backend/.venv/bin/python -m uvicorn app.main:app --app-dir ../backend --host 127.0.0.1 --port ${PORT}`,
    url: `http://127.0.0.1:${PORT}/healthz`,
    timeout: 30_000,
    reuseExistingServer: false,
  },
});