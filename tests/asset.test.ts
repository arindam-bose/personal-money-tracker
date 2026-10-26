// Asset accounts (a house, a car): worth what the user last updated them to, counted in net
// tangible assets, carried into the next year, and never used by an entry.

import { describe, expect, it } from "vitest";
import { accountsOverview, balanceSeries, type Ledger } from "../src/derive";
import { checkDraft, emptyDraft } from "../src/entries";
import { emptyYearFile, nextYearSetup } from "../src/rollover";
import { blankSetup, saveAccount, saveValuation, withStart } from "../src/setup";
import type { Account, YearSetup } from "../src/types";
import { validateYearFile } from "../src/validate";

const checking: Account = { id: "a_checking", name: "Checking", type: "checking", ref: "", opening: 1000000 };
const car: Account = { id: "a_car", name: "Car", type: "asset", ref: "", opening: 0 };
const setup = (): YearSetup => ({ ...blankSetup(2026), accounts: [checking, car] });
const ledgerOf = (s: YearSetup): Ledger => ({ year: s.year, accounts: s.accounts, categories: s.categories, expenses: [], earnings: [], transfers: [] });
const carIn = (s: YearSetup) => s.accounts.find((a) => a.id === "a_car")!;

describe("an asset", () => {
  it("has no opening balance", () => {
    const s = saveAccount(setup(), { ...car, id: "", name: "House", opening: 5000 });
    expect(s.accounts[2]).toEqual({ id: "a_house", name: "House", type: "asset", ref: "", opening: 0 });
  });

  it("counts in net tangible assets at its last value, once it has one", () => {
    let s = saveValuation(setup(), "a_car", "2026-02-01", 1800000);
    s = saveValuation(s, "a_car", "2026-09-01", 1650000);
    const l = ledgerOf(s);
    expect(accountsOverview(l, "2026-01-31")).toMatchObject({ assetsWorth: 0, netTangibleAssets: 1000000 });
    expect(accountsOverview(l, "2026-06-30")).toMatchObject({ assetsWorth: 1800000, investmentsWorth: 0, netTangibleAssets: 2800000 });
    expect(balanceSeries(l, ["2026-12-31"])[0]).toMatchObject({ assetsWorth: 1650000, netTangibleAssets: 2650000 });
  });

  it("keeps its last value, dated January 1, into the next year", () => {
    let s = saveValuation(setup(), "a_car", "2026-02-01", 1800000);
    s = saveValuation(s, "a_car", "2026-09-01", 1650000);
    expect(carIn(nextYearSetup(s, ledgerOf(s)))).toEqual({ ...car, valuations: [{ date: "2027-01-01", amount: 1650000 }] });
    // One without a value starts without one.
    expect(carIn(nextYearSetup(setup(), ledgerOf(setup())))).toEqual(car);
  });

  it("moves its value up to a later start day instead of blocking the move", () => {
    let s = saveValuation(setup(), "a_car", "2026-01-01", 1800000);
    s = saveValuation(s, "a_car", "2026-02-01", 1750000);
    s = saveValuation(s, "a_car", "2026-09-01", 1650000);
    const moved = withStart({ setup: s, expenses: [], earnings: [], transfers: [] }, "2026-03-01");
    expect(carIn(moved).valuations).toEqual([{ date: "2026-03-01", amount: 1750000 }, { date: "2026-09-01", amount: 1650000 }]);
  });

  it("can't be used by an entry", () => {
    const expense = { ...emptyDraft("expense", "2026-04-01"), item: "x", amount: "10", account: "a_car", cat: "ce_bills" };
    expect(checkDraft(expense, setup(), "e1")).toMatchObject({ ok: false, errors: { account: "Pick an account." } });
    const transfer = { ...emptyDraft("transfer", "2026-04-01"), item: "x", amount: "10", from: "a_checking", to: "a_car", cat: "ct_general-transfer" };
    expect(checkDraft(transfer, setup(), "x1")).toMatchObject({ ok: false, errors: { to: "Pick the account the money went to." } });
  });
});

describe("importing an asset", () => {
  const file = (over: Partial<Account> = {}) => emptyYearFile({ ...blankSetup(2026), accounts: [checking, { ...car, ...over }] });

  it("accepts one with values", () => {
    expect(validateYearFile(file({ valuations: [{ date: "2026-02-01", amount: 1800000 }] })).ok).toBe(true);
  });

  it("reports one with an opening balance, or an entry that uses it", () => {
    const r1 = validateYearFile(file({ opening: 100 }));
    expect(r1.ok === false && r1.errors).toEqual([`Asset "a_car" must open at 0: its value comes from its updates.`]);
    const f = file();
    f.transfers = [{ id: "x1", date: "2026-03-01", item: "Down payment", amount: 500000, from: "a_checking", to: "a_car", cat: "ct_general-transfer", notes: "" }];
    const r2 = validateYearFile(f);
    expect(r2.ok === false && r2.errors).toEqual([`Transfer "x1" uses asset "a_car": assets only change by updating their value.`]);
  });
});
