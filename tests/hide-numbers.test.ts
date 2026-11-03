import { afterEach, describe, expect, it } from "vitest";
import { HIDDEN_AMOUNT, maskedCents, maskedCompact, setNumbersHidden } from "../src/hide-numbers";
import { formatCents, formatCompact } from "../src/money";

describe("hiding the numbers", () => {
  afterEach(() => setNumbersHidden(false));

  it("shows amounts as usual by default", () => {
    expect(maskedCents(123456)).toBe(formatCents(123456));
    expect(maskedCompact(123456)).toBe(formatCompact(123456));
  });

  it("shows every amount the same while hidden, whatever its size or sign", () => {
    setNumbersHidden(true);
    for (const amount of [0, 5, 123456, -987654321]) {
      expect(maskedCents(amount)).toBe(HIDDEN_AMOUNT);
      expect(maskedCompact(amount)).toBe(HIDDEN_AMOUNT);
    }
  });

  it("shows them again once turned off", () => {
    setNumbersHidden(true);
    setNumbersHidden(false);
    expect(maskedCents(123456)).toBe(formatCents(123456));
  });
});
