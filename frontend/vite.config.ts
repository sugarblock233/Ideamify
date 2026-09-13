import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev: Vite on 5173 proxies /api to the local backend (SPEC 9: dev mode runs
// Vite + API separately; production serves the same-origin build).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": { target: "http://127.0.0.1:8000", changeOrigin: false },
    },
  },
  build: { outDir: "dist" },
});