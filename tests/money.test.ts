import { describe, expect, it } from "vitest";
import { amountPrefix, amountText, formatCents, formatPercent, parseCents, parseSignedCents } from "../src/money";

describe("amountPrefix", () => {
  // Matches the start of the amount as the form writes it.
  const finds = (q: string, cents: number) => amountText(cents).startsWith(amountPrefix(q)!);
  it("finds amounts that start with what was typed", () => {
    expect(finds("19", 1947)).toBe(true);
    expect(finds("197", 197225)).toBe(true);
    expect(finds("$1,97", 197225)).toBe(true);
    expect(finds("1972.2", 197225)).toBe(true);
    expect(finds("45.", 4567)).toBe(true);
    expect(finds("45.67", 4567)).toBe(true);
  });
  it("doesn't find digits in the middle or a different cents", () => {
    expect(finds("50", 15000)).toBe(false);
    expect(finds("45.6", 4570)).toBe(false);
  });
  it.each(["45.678", "coffee", "", "-5"])("%s isn't an amount", (q) => {
    expect(amountPrefix(q)).toBeNull();
  });
});

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

describe("formatPercent", () => {
  it("always shows 2 decimals", () => {
    expect(formatPercent(0.285)).toBe("28.50%");
    expect(formatPercent(0.033)).toBe("3.30%");
    expect(formatPercent(1)).toBe("100.00%");
    expect(formatPercent(0)).toBe("0.00%");
    expect(formatPercent(null)).toBe("–");
  });
});
