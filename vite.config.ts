import { readFileSync } from "node:fs";
import { defineConfig, type Plugin } from "vitest/config";
import preact from "@preact/preset-vite";
import pkg from "./package.json" with { type: "json" };

/**
 * Writes the offline copy's service worker (src/service-worker.js) as sw.js, with this
 * release's version and every built file filled in. Only in a build: in development
 * there is no service worker, so edits always show.
 */
function serviceWorker(): Plugin {
  return {
    name: "money-tracker-sw",
    apply: "build",
    enforce: "post",
    generateBundle(_options, bundle) {
      const files = ["./", ...Object.keys(bundle).filter((f) => !f.endsWith(".map"))];
      const source = readFileSync(new URL("./src/service-worker.js", import.meta.url), "utf-8")
        .replace('"__VERSION__"', JSON.stringify(pkg.version))
        .replace("__FILES__", JSON.stringify(files));
      this.emitFile({ type: "asset", fileName: "sw.js", source });
    },
  };
}

export default defineConfig({
  // Relative asset paths, so the build works from any sub-folder of the website.
  base: "./",
  plugins: [preact(), serviceWorker()],
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
