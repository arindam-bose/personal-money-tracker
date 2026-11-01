// The README names the current version and its date: this keeps them in step with package.json.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { released, version } from "../package.json";

describe("README", () => {
  it("names the version and release date in package.json", () => {
    const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
    const day = new Date(`${released}T00:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
    expect(readme).toContain(`**Version ${version}**, released ${day}`);
  });
});
