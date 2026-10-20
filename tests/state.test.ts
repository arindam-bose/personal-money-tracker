import { beforeEach, describe, expect, it } from "vitest";
import { importYear } from "../src/backup";
import { loadYear } from "../src/db";
import { current, ensureTag, openYear, setBudget } from "../src/state";
import { freshDb, sample } from "./helpers";

beforeEach(async () => {
  await freshDb();
  await importYear(sample());
  await openYear(2026);
});

describe("state changes", () => {
  it("keeps every change when several start at once", async () => {
    // Like typing targets down a column: each save starts before the last one finished.
    await Promise.all([
      setBudget("default", "ce_food", 1),
      setBudget("default", "ce_rent", 2),
      setBudget("default", "ce_charity", 3),
      setBudget("default", "ce_loan", 4),
      ensureTag("New tag"),
    ]);
    const want = { ce_food: 1, ce_rent: 2, ce_charity: 3, ce_loan: 4 };
    expect(current.value!.setup.budgets.default).toEqual(want);
    const stored = (await loadYear(2026))!.setup;
    expect(stored.budgets.default).toEqual(want);
    expect(stored.tags.map((t) => t.name)).toContain("New tag");
  });

  it("clears a month override and drops the empty month", async () => {
    await setBudget("2026-02", "ce_food", null);
    expect(current.value!.setup.budgets["2026-02"]).toBeUndefined();
  });

  it("carries on after a failed change", async () => {
    current.value = { ...current.value!, setup: { ...current.value!.setup, closed: true } };
    await expect(setBudget("default", "ce_food", 5)).rejects.toThrow("closed");
    current.value = { ...current.value!, setup: { ...current.value!.setup, closed: false } };
    await setBudget("default", "ce_food", 6);
    expect(current.value!.setup.budgets.default.ce_food).toBe(6);
  });
});
