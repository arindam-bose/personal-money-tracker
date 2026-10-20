import { defineConfig } from "vitest/config";
import preact from "@preact/preset-vite";

export default defineConfig({
  // Relative asset paths, so the build works from any sub-folder of the website.
  base: "./",
  plugins: [preact()],
  test: {
    environment: "node",
    setupFiles: ["tests/setup.ts"],
  },
});
