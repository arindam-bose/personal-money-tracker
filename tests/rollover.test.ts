import { beforeEach, describe, expect, it } from "vitest";
import { importYear } from "../src/backup";
import { loadYear } from "../src/db";
import { nextYearSetup } from "../src/rollover";
import { closeYear, current, openYear, readOnly, reopenYear, setBudget, years } from "../src/state";
import type { YearSetup } from "../src/types";
import { freshDb, sample } from "./helpers";

const file = sample();
const setup: YearSetup = { ...file };

describe("nextYearSetup", () => {
  const next = nextYearSetup(setup, file);

  it("opens at the closing balances, with investments back at 0", () => {
    expect(next.year).toBe(2027);
    expect(Object.fromEntries(next.accounts.map((a) => [a.id, a.opening]))).toEqual({
      a_checking: 983000, a_savings: 1046234, a_wallet: 3550, a_card: -15000, a_ira: 0,
    });
    expect(next.accounts[3]!.limit).toBe(500000);
  });

  it("carries setup and usual budgets, not one-month overrides", () => {
    expect(next.categories).toEqual(file.categories);
    expect(next.tags).toEqual(file.tags);
    expect(next.people).toEqual(file.people);
    expect(next.budgets).toEqual({ default: { ce_food: 40000, ce_rent: 150000 } });
  });
});

describe("closing a year", () => {
  beforeEach(async () => {
    await freshDb();
    await importYear(sample());
    await openYear(2026);
  });

  it("makes the year read-only and starts the next one", async () => {
    expect(await closeYear()).toEqual({ next: 2027, created: true });
    expect(current.value!.setup.year).toBe(2027);
    expect(current.value!.expenses).toEqual([]);
    expect(current.value!.setup.accounts.find((a) => a.id === "a_checking")!.opening).toBe(983000);
    expect(years.value.map((y) => [y.setup.year, !!y.setup.closed])).toEqual([[2027, false], [2026, true]]);

    const old = (await loadYear(2026))!;
    expect(old.setup.closed).toBe(true);
    expect(old.expenses).toHaveLength(8); // nothing removed
    await openYear(2026);
    expect(readOnly.value).toBe(true);
    await expect(setBudget("default", "ce_food", 1)).rejects.toThrow("closed");
  });

  it("leaves an existing next year alone", async () => {
    const next = sample();
    next.year = 2027;
    next.expenses = next.earnings = next.transfers = [] as never[];
    next.budgets = { default: {} };
    next.accounts = next.accounts.map((a) => ({ ...a, opening: 1 }));
    await importYear(next);
    await openYear(2026);
    expect(await closeYear()).toEqual({ next: 2027, created: false });
    expect(current.value!.setup.accounts.every((a) => a.opening === 1)).toBe(true);
  });

  it("can be reopened", async () => {
    await closeYear();
    await reopenYear(2026);
    expect(current.value!.setup.year).toBe(2026);
    expect(readOnly.value).toBe(false);
    await setBudget("default", "ce_food", 1);
  });
});
