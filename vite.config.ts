import { defineConfig } from "vitest/config";
import preact from "@preact/preset-vite";

export default defineConfig({
  // Relative asset paths, so the build works from any sub-folder of the website.
  base: "./",
  plugins: [preact()],
  build: {
    // The Reports page bundles ECharts (~590 kB, ~200 kB gzipped). It loads only when
    // Reports is opened, so the size is expected; warn only if it grows past this.
    chunkSizeWarningLimit: 650,
  },
  test: {
    environment: "node",
    setupFiles: ["tests/setup.ts"],
  },
});
