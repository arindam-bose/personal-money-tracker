// Fixes from the code review after loans, investment balances, assets and closing accounts
// (v2.0.11): each test is a way the data could quietly go wrong before.

import { describe, expect, it } from "vitest";
import { accountsOverview, balanceSeries, ledgerOf, loanStatus } from "../src/derive";
import { emptyYearFile } from "../src/rollover";
import {
  assertClosedStayEmpty, blankSetup, closeAccount, SetupError, saveAccount, saveValuation, usageOf, withStart,
} from "../src/setup";
import type { Account, Expense, Transfer, YearSetup } from "../src/types";
import { validateYearFile } from "../src/validate";

const checking: Account = { id: "a_checking", name: "Checking", type: "checking", ref: "", opening: 1000000 };
const old: Account = { id: "a_old", name: "Old Savings", type: "savings", ref: "", opening: 50000 };
const spend = (id: string, date: string, amount: number, account = "a_checking"): Expense =>
  ({ id, date, item: "Spend", amount, account, cat: "ce_bills", tags: [], notes: "" });
const move = (id: string, date: string, amount: number, from: string, to: string): Transfer =>
  ({ id, date, item: "Move", amount, from, to, cat: "ct_general-transfer", notes: "" });
const year = (accounts: Account[], expenses: Expense[] = [], transfers: Transfer[] = [], start?: string) => ({
  setup: { ...blankSetup(2026), accounts, ...(start ? { start } : {}) } as YearSetup, expenses, earnings: [], transfers,
});

describe("changing an account's type", () => {
  const d = year([checking, old], [spend("e1", "2026-02-01", 100)], [move("x1", "2026-02-02", 100, "a_checking", "a_old")]);
  const u = usageOf(d);

  it("can't turn an account with entries into an asset", () => {
    expect(() => saveAccount(d.setup, { ...checking, type: "asset" }, u)).toThrow("Checking has 2 entries, and an asset can't have any");
  });

  it("can't turn an account with expenses or earnings into a loan, but transfers are fine", () => {
    const loan = { loanStart: "2026-01-01", loanAmount: 100000, rate: 5 };
    expect(() => saveAccount(d.setup, { ...checking, type: "loan", ...loan }, u)).toThrow("an expense or earning, and a loan only takes transfers");
    expect(saveAccount(d.setup, { ...old, type: "loan", ...loan }, u).accounts[1]!.type).toBe("loan");
  });
});

describe("a closed account stays at 0", () => {
  const d = year([checking, old], [], [move("x1", "2026-02-28", 50000, "a_old", "a_checking")]);
  const closed = { ...d, setup: closeAccount(d, "a_old", "2026-03-01", "2026-10-26") };

  it("refuses an edit or delete before the close that would change what it held", () => {
    const smaller = { ...closed, transfers: [move("x1", "2026-02-28", 40000, "a_old", "a_checking")] };
    expect(() => assertClosedStayEmpty(closed, smaller)).toThrow("Old Savings was closed on Mar 1, and this would mean it still has $100.00 then");
    expect(() => assertClosedStayEmpty(closed, { ...closed, transfers: [] })).toThrow(SetupError);
  });

  it("allows edits that leave it at 0, like a note or another day before the close", () => {
    const moved = { ...closed, transfers: [{ ...move("x1", "2026-02-10", 50000, "a_old", "a_checking"), notes: "Closing" }] };
    expect(() => assertClosedStayEmpty(closed, moved)).not.toThrow();
  });

  it("can't be closed ahead of time", () => {
    expect(() => closeAccount(d, "a_old", "2026-11-01", "2026-10-26")).toThrow("pick today or earlier");
  });
});

describe("moving the start", () => {
  it("doesn't give an asset a value on the day it closed", () => {
    let setup: YearSetup = { ...blankSetup(2026), accounts: [checking, { id: "a_car", name: "Car", type: "asset", ref: "", opening: 0 }] };
    setup = saveValuation(setup, "a_car", "2026-01-01", 2000000);
    const d = { setup, expenses: [], earnings: [], transfers: [] };
    const closed = { ...d, setup: closeAccount(d, "a_car", "2026-06-01", "2026-10-26") };
    const moved = withStart(closed, "2026-06-01");
    expect(moved.accounts[1]!.valuations).toEqual([]);
    expect(validateYearFile(emptyYearFile(moved)).ok).toBe(true);
  });

  it("earlier, takes off the interest a loan's opening already had, instead of counting it twice", () => {
    const mortgage: Account = { id: "a_m", name: "Mortgage", type: "loan", ref: "", opening: -30000000, loanStart: "2024-01-15", loanAmount: 32000000, rate: 6 };
    // Tracked from Jan 1, nothing paid: what it owes on the morning of Jun 1.
    const fromJan = year([checking, mortgage]);
    const owedJun1 = loanStatus(ledgerOf(fromJan), mortgage, "2026-05-31").balance;
    // The same loan tracked from Jun 1 opens at that; moving the start back to Jan 1 gives the Jan 1 amount again.
    const fromJun = year([checking, { ...mortgage, opening: owedJun1 }], [], [], "2026-06-01");
    const back = withStart(fromJun, null);
    expect(Math.abs(back.accounts[1]!.opening - mortgage.opening)).toBeLessThanOrEqual(1);
    // And it owes the same on Jun 1 either way.
    const again = loanStatus(ledgerOf({ ...fromJan, setup: back }), back.accounts[1]!, "2026-05-31").balance;
    expect(Math.abs(again - owedJun1)).toBeLessThanOrEqual(1);
  });
});

describe("net worth without loans", () => {
  it("is worked out once, alongside net worth", () => {
    const loan: Account = { id: "a_l", name: "Loan", type: "loan", ref: "", opening: -500000, loanStart: "2025-01-01", loanAmount: 900000, rate: 0 };
    const l = ledgerOf(year([checking, loan]));
    expect(accountsOverview(l, "2026-03-31")).toMatchObject({ netWorth: 500000, netWorthWithoutLoans: 1000000 });
    expect(balanceSeries(l, ["2026-03-31"])[0]).toMatchObject({ netWorth: 500000, netWorthWithoutLoans: 1000000 });
  });
});

describe("importing", () => {
  it("reports an expense or earning on a loan account", () => {
    const loan: Account = { id: "a_l", name: "Loan", type: "loan", ref: "", opening: 0, loanStart: "2026-01-01", loanAmount: 900000, rate: 5 };
    const f = emptyYearFile({ ...blankSetup(2026), accounts: [checking, loan] });
    f.expenses = [spend("e1", "2026-02-01", 100, "a_l")];
    const r = validateYearFile(f);
    expect(r.ok === false && r.errors).toEqual([`Expense "e1" uses loan "a_l": a loan only takes transfers.`]);
  });
});
