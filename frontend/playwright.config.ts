import { defineConfig } from "@playwright/test";

// E2E server = production shape: uvicorn serving the prebuilt dist/ with a
// scratch DB (port 8021 so it never collides with a dev stack on 8000/5173).
// Run `npm run build` beforehand; browsers via `npx playwright install chromium`.
//
// CI-configurable environment overrides (no changes reflected elsewhere):
//   E2E_PYTHON — python interpreter running uvicorn (default: ../backend/.venv/bin/python)
//   E2E_DB_DIR — directory for the scratch database (default: /tmp/rm-e2e)
const PORT = 8021;
const E2E_PYTHON = process.env.E2E_PYTHON ?? "../backend/.venv/bin/python";
const E2E_DB_DIR = process.env.E2E_DB_DIR ?? "/tmp/rm-e2e";

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
      `mkdir -p ${E2E_DB_DIR} && ` +
      `RESEARCHMAP_STATIC=$PWD/dist ` +
      `RESEARCHMAP_DB=${E2E_DB_DIR}/data.db ` +
      // Two tokens: the UI actor plus a second "other researcher" used by
      // e2e/collab.spec.ts to simulate a concurrent commit (A02 conflict).
      `RESEARCHMAP_TOKENS='{"e2e":"e2e-test-token-0001","e2e-other":"e2e-other-token-0001"}' ` +
      `${E2E_PYTHON} -m uvicorn app.main:app --app-dir ../backend --host 127.0.0.1 --port ${PORT}`,
    url: `http://127.0.0.1:${PORT}/healthz`,
    timeout: 30_000,
    reuseExistingServer: false,
  },
});