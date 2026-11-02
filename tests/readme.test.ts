// The README names the current version: this keeps it in step with package.json.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { version } from "../package.json";

describe("README", () => {
  it("names the version in package.json", () => {
    const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
    expect(readme).toContain(`**Version ${version}**`);
  });
});
