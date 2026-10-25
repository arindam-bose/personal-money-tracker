import { describe, expect, it } from "vitest";
import { isNewer } from "../src/offline";

describe("isNewer", () => {
  it("compares releases figure by figure, not as text", () => {
    expect(isNewer("1.0.10", "1.0.9")).toBe(true);
    expect(isNewer("1.0.9", "1.0.10")).toBe(false);
    expect(isNewer("2.0.1", "1.0.33")).toBe(true);
    expect(isNewer("1.0.33", "1.0.33")).toBe(false);
  });

  it("never calls an older cached release an update", () => {
    expect(isNewer("1.0.32", "1.0.33")).toBe(false);
  });
});
