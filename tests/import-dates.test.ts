import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { longDay, updatedAt, updatedPair } from "../src/derive";

// The formats follow the reader's language; pinned to US English, on New York's clock, so the test reads
// the same on any machine.
const toLocaleString = Date.prototype.toLocaleString;
const toLocaleDateString = Date.prototype.toLocaleDateString;
beforeEach(() => {
  vi.spyOn(Date.prototype, "toLocaleString").mockImplementation(function (this: Date, _l, o) {
    return toLocaleString.call(this, "en-US", { timeZone: "America/New_York", ...o });
  });
  vi.spyOn(Date.prototype, "toLocaleDateString").mockImplementation(function (this: Date, _l, o) {
    return toLocaleDateString.call(this, "en-US", { timeZone: "America/New_York", ...o });
  });
});
afterEach(() => vi.restoreAllMocks());

describe("the import dialog's dates", () => {
  it("say the Last updated time with the weekday, to the minute", () => {
    expect(updatedAt("2026-11-08T08:45:12Z")).toBe("Sunday, Nov 8, 2026, 03:45 AM");
  });

  it("say the export day with the weekday", () => {
    expect(longDay(new Date("2026-11-08T15:00:00Z"))).toBe("Sunday, Nov 8, 2026");
  });

  it("show two times minutes apart to the minute", () => {
    expect(updatedPair("2026-11-08T08:45:12Z", "2026-11-08T08:47:30Z"))
      .toEqual(["Sunday, Nov 8, 2026, 03:45 AM", "Sunday, Nov 8, 2026, 03:47 AM"]);
  });

  it("give both their seconds when the minute alone would make them read the same", () => {
    expect(updatedPair("2026-11-08T08:45:12Z", "2026-11-08T08:45:40Z"))
      .toEqual(["Sunday, Nov 8, 2026, 03:45:12 AM", "Sunday, Nov 8, 2026, 03:45:40 AM"]);
  });

  it("leave the seconds out when the two are the same moment, or one is missing", () => {
    expect(updatedPair("2026-11-08T08:45:12Z", "2026-11-08T08:45:12.600Z"))
      .toEqual(["Sunday, Nov 8, 2026, 03:45 AM", "Sunday, Nov 8, 2026, 03:45 AM"]);
    expect(updatedPair("2026-11-08T08:45:12Z", undefined)).toEqual(["Sunday, Nov 8, 2026, 03:45 AM", "Unknown"]);
  });
});
