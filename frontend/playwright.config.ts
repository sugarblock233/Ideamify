import { defineConfig } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// A fresh database per invocation; E2E_DB_DIR may override it with scratch data.
const PORT = Number(process.env.E2E_PORT ?? 8021);
const E2E_PYTHON = process.env.E2E_PYTHON ?? "../backend/.venv/bin/python";
const E2E_DB_DIR = process.env.E2E_DB_DIR ?? mkdtempSync(path.join(tmpdir(), "researchmap-e2e-"));
const quote = (value: string) => "'" + value.replaceAll("'", "'\"'\"'") + "'";

export default defineConfig({
  testDir: "./e2e",
  timeout: 45_000,
  retries: 0,
  workers: 1,
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    headless: true,
    trace: "retain-on-failure",
    // Every E2E spec selects controls by their Chinese accessible names; pin
    // the browser locale so the i18n browser-language probe resolves "zh".
    locale: "zh-CN",
  },
  webServer: {
    command: `mkdir -p ${quote(E2E_DB_DIR)} && ${quote(E2E_PYTHON)} -m uvicorn app.main:app --app-dir ../backend --host 127.0.0.1 --port ${PORT}`,
    env: {
      RESEARCHMAP_STATIC: path.resolve("dist"),
      RESEARCHMAP_DB: path.join(E2E_DB_DIR, "data.db"),
      // Synthetic actors used for browser/AI collaboration tests.
      RESEARCHMAP_TOKENS: '{"e2e":"e2e-test-token-0001","e2e-other":"e2e-other-token-0001"}',
    },
    url: `http://127.0.0.1:${PORT}/healthz`,
    timeout: 30_000,
    reuseExistingServer: false,
  },
});
