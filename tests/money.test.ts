import { describe, expect, it } from "vitest";
import { formatCents, parseCents, parseSignedCents } from "../src/money";

describe("parseCents", () => {
  it.each([
    ["12.34", 1234],
    ["$1,234.5", 123450],
    ["7", 700],
    ["0.07", 7],
    ["875.463", null],
    ["-5", null],
    ["abc", null],
    ["", null],
    // The float trap: 0.1 + 0.2 style errors must not happen.
    ["87546.30", 8754630],
  ])("%s -> %s", (text, want) => {
    expect(parseCents(text)).toBe(want);
  });
});

describe("formatCents", () => {
  it("formats dollars and negatives", () => {
    expect(formatCents(13685138)).toBe("$136,851.38");
    expect(formatCents(-310779)).toBe("-$3,107.79");
    expect(formatCents(0)).toBe("$0.00");
  });
});

describe("parseSignedCents", () => {
  it("allows a leading minus", () => {
    expect(parseSignedCents("-12.50")).toBe(-1250);
    expect(parseSignedCents("−3")).toBe(-300);
    expect(parseSignedCents("7")).toBe(700);
    expect(parseSignedCents("--1")).toBeNull();
  });
});
