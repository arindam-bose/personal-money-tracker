// Investment balances: the user notes what an investment account is worth from time to time.
// It's worth the last balance noted until the next one, and only then counts in net tangible assets.

import { describe, expect, it } from "vitest";
import { accountsOverview, balanceSeries, valuationOf, type Ledger } from "../src/derive";
import { emptyYearFile, nextYearSetup } from "../src/rollover";
import { blankSetup, deleteValuation, duplicateAccount, saveAccount, saveValuation, SetupError, withStart } from "../src/setup";
import type { Account, Transfer, YearSetup } from "../src/types";
import { validateYearFile } from "../src/validate";

const checking: Account = { id: "a_checking", name: "Checking", type: "checking", ref: "", opening: 1000000 };
const gia: Account = { id: "a_gia", name: "Brokerage", type: "investment", ref: "", opening: 0 };
const ira: Account = { id: "a_ira", name: "Roth IRA", type: "investment", ref: "", opening: 0 };
const contribute = (date: string, amount: number): Transfer => ({
  id: `x_${date}`, date, item: "Into the brokerage", amount, from: "a_checking", to: "a_gia", cat: "ct_investment-stocks-cryptos", notes: "",
});
const setup = (): YearSetup => ({ ...blankSetup(2026), accounts: [checking, gia, ira] });
const ledgerOf = (s: YearSetup, transfers: Transfer[] = []): Ledger =>
  ({ year: s.year, accounts: s.accounts, categories: s.categories, expenses: [], earnings: [], transfers });
const giaIn = (s: YearSetup) => s.accounts.find((a) => a.id === "a_gia")!;

describe("noting a balance", () => {
  it("keeps one per day, oldest first, and a second on the same day replaces the first", () => {
    let s = saveValuation(setup(), "a_gia", "2026-10-01", 1200000);
    s = saveValuation(s, "a_gia", "2026-03-01", 900000);
    s = saveValuation(s, "a_gia", "2026-10-01", 1248000);
    expect(giaIn(s).valuations).toEqual([{ date: "2026-03-01", amount: 900000 }, { date: "2026-10-01", amount: 1248000 }]);
  });

  it("is for investment accounts, on a day in the tracked year, as a whole amount", () => {
    expect(() => saveValuation(setup(), "a_checking", "2026-10-01", 100)).toThrow(SetupError);
    expect(() => saveValuation(setup(), "a_gia", "2025-12-31", 100)).toThrow("Pick a day in 2026");
    expect(() => saveValuation({ ...setup(), start: "2026-07-01" }, "a_gia", "2026-06-30", 100)).toThrow("Tracking starts");
    expect(() => saveValuation(setup(), "a_gia", "2026-10-01", -1)).toThrow("balance");
  });

  it("can be deleted; the last one going drops the list", () => {
    const s = saveValuation(setup(), "a_gia", "2026-10-01", 1200000);
    expect(giaIn(deleteValuation(s, "a_gia", "2026-10-01"))).toEqual(gia);
  });

  it("stays through an edit, but not on a copy or after changing the account's type", () => {
    const s = saveValuation(setup(), "a_gia", "2026-10-01", 1200000);
    const valued = giaIn(s);
    expect(giaIn(saveAccount(s, { ...valued, name: "GIA" })).valuations).toEqual(valued.valuations);
    expect(giaIn(saveAccount(s, { ...valued, type: "savings" })).valuations).toBeUndefined();
    const copy = duplicateAccount(s, "a_gia");
    expect(copy.setup.accounts.find((a) => a.id === copy.id)!.valuations).toBeUndefined();
  });

  it("keeps tracking from starting after it", () => {
    const s = saveValuation(setup(), "a_gia", "2026-03-01", 900000);
    expect(() => withStart({ setup: s, expenses: [], earnings: [], transfers: [] }, "2026-04-01")).toThrow("balance update");
  });
});

describe("what an investment account is worth", () => {
  let s = saveValuation(setup(), "a_gia", "2026-03-01", 900000);
  s = saveValuation(s, "a_gia", "2026-10-01", 1248000);
  const l = ledgerOf(s, [contribute("2026-05-01", 50000)]);

  it("is the last balance noted on or before the day, whatever moved since", () => {
    expect(valuationOf(giaIn(s), "2026-02-28")).toBeNull();
    expect(valuationOf(giaIn(s), "2026-05-31")).toEqual({ date: "2026-03-01", amount: 900000 });
    expect(valuationOf(giaIn(s))).toEqual({ date: "2026-10-01", amount: 1248000 });
  });

  it("counts in net tangible assets once noted; an account without one is left out", () => {
    const before = accountsOverview(l, "2026-02-28");
    expect(before.investmentsWorth).toBe(0);
    expect(before.netTangibleAssets).toBe(before.availableCash);

    const may = accountsOverview(l, "2026-05-31");
    // The $500 put in on May 1 left checking but isn't in the March balance: it shows at the next update.
    expect(may.availableCash).toBe(950000);
    expect(may.investmentsWorth).toBe(900000);
    expect(may.netTangibleAssets).toBe(950000 + 900000);
    expect([...may.valuations.keys()]).toEqual(["a_gia"]);
    expect(may.invested.get("a_gia")).toBe(50000);
  });

  it("is in the balance series", () => {
    expect(balanceSeries(l, ["2026-02-28", "2026-12-31"]).map((p) => [p.investmentsWorth, p.netTangibleAssets]))
      .toEqual([[0, 1000000], [1248000, 950000 + 1248000]]);
  });

  it("starts again with no balance in the next year", () => {
    expect(nextYearSetup(s, l).accounts.find((a) => a.id === "a_gia")).toEqual({ ...gia });
  });
});

describe("importing balances", () => {
  const file = (accounts: Account[], start?: string) => emptyYearFile({ ...blankSetup(2026), accounts, ...(start ? { start } : {}) });

  it("accepts balance updates on an investment account", () => {
    expect(validateYearFile(file([{ ...gia, valuations: [{ date: "2026-10-01", amount: 1248000 }] }])).ok).toBe(true);
  });

  it("reports them on another type, outside the tracked year, twice on a day, or not in cents", () => {
    const errors = (a: Account, start?: string) => {
      const r = validateYearFile(file([a], start));
      return r.ok ? [] : r.errors;
    };
    expect(errors({ ...checking, valuations: [{ date: "2026-10-01", amount: 1 }] })[0]).toMatch(/isn't an investment or asset account/);
    expect(errors({ ...gia, valuations: [{ date: "2025-10-01", amount: 1 }] })[0]).toMatch(/isn't a date in 2026/);
    expect(errors({ ...gia, valuations: [{ date: "2026-03-01", amount: 1 }] }, "2026-07-01")[0]).toMatch(/isn't a date in 2026/);
    expect(errors({ ...gia, valuations: [{ date: "2026-10-01", amount: 1.5 }] })[0]).toMatch(/whole cents/);
    expect(errors({ ...gia, valuations: [{ date: "2026-10-01", amount: 1 }, { date: "2026-10-01", amount: 2 }] })[0]).toMatch(/two balance updates/);
  });
});
