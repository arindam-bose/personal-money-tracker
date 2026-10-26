// Loan and mortgage accounts: what they owe grows by monthly interest on the balance and
// shrinks with each transfer into them, and it comes off net worth.

import { describe, expect, it } from "vitest";
import { accountsOverview, balanceSeries, loanStatus, moneyFlow, summarize, type Ledger } from "../src/derive";
import { checkDraft, emptyDraft, suggestTransferCategory } from "../src/entries";
import { emptyYearFile, nextYearSetup } from "../src/rollover";
import { blankSetup, saveAccount, SetupError, withoutPeople, withStart } from "../src/setup";
import type { Account, Transfer, YearSetup } from "../src/types";
import { validateYearFile } from "../src/validate";

const checking: Account = { id: "a_checking", name: "Checking", type: "checking", ref: "", opening: 1000000 };
/** $300,000 at 6% (0.5% a month), taken out mid-March. */
const mortgage: Account = {
  id: "a_mortgage", name: "Mortgage", type: "loan", ref: "", opening: 0, loanStart: "2026-03-15", loanAmount: 30000000, rate: 6,
};
const pay = (id: string, date: string, amount: number, to = "a_mortgage"): Transfer => ({
  id, date, item: "Mortgage payment", amount, from: "a_checking", to, cat: "ct_loan-payments", notes: "",
});

function year(accounts: Account[], transfers: Transfer[] = [], start?: string): Ledger {
  const setup = blankSetup(2026);
  return { year: 2026, ...(start ? { start } : {}), accounts, categories: setup.categories, expenses: [], earnings: [], transfers };
}

describe("a loan taken out this year", () => {
  const l = year([checking, mortgage], [pay("x1", "2026-04-15", 200000), pay("x2", "2026-05-15", 200000)]);

  it("owes nothing before it starts, then its amount from the start date", () => {
    expect(loanStatus(l, mortgage, "2026-03-14").balance).toBe(0);
    expect(loanStatus(l, mortgage, "2026-03-15").balance).toBe(-30000000);
  });

  it("adds rate ÷ 12 of what's owed each month, before that day's payment", () => {
    // Apr 15: +1,500.00 interest, −2,000 paid. May 15: +1,497.50 on $299,500, −2,000 paid.
    expect(loanStatus(l, mortgage, "2026-04-15")).toEqual({ balance: -29950000, interest: 150000 });
    expect(loanStatus(l, mortgage, "2026-05-31")).toEqual({ balance: -29899750, interest: 299750 });
    // Jun 15: 0.5% of $298,997.50 is $1,494.9875, rounded to the cent.
    expect(loanStatus(l, mortgage, "2026-06-15").balance).toBe(-29899750 - 149499);
  });

  it("comes off net worth", () => {
    const o = accountsOverview(l, "2026-05-31");
    expect(o.availableCash).toBe(600000);
    expect(o.loanDebt).toBe(29899750);
    expect(o.loans).toEqual([{ account: mortgage, owed: 29899750, interest: 299750 }]);
    expect(o.netWorth).toBe(600000 - 29899750);
    expect(balanceSeries(l, ["2026-05-31"])[0]).toMatchObject({ loanDebt: 29899750, netWorth: 600000 - 29899750 });
  });

  it("runs interest only to today, or to the end of the year once it's over", () => {
    expect(loanStatus(l, mortgage, undefined, "2026-05-31")).toEqual(loanStatus(l, mortgage, "2026-05-31"));
    expect(loanStatus(l, mortgage, undefined, "2027-02-01")).toEqual(loanStatus(l, mortgage, "2026-12-31"));
  });

  it("opens next year at what it owed on December 31, without adding the amount again", () => {
    const setup: YearSetup = { ...blankSetup(2026), accounts: [checking, mortgage] };
    const next = nextYearSetup(setup, l);
    const owed = loanStatus(l, mortgage, "2026-12-31").balance;
    expect(next.accounts.find((a) => a.id === "a_mortgage")).toEqual({ ...mortgage, opening: owed });
    const l2: Ledger = { ...year(next.accounts), year: 2027 };
    // Only Jan 15's interest by mid-January.
    expect(loanStatus(l2, next.accounts[1]!, "2027-01-15").balance).toBe(owed - Math.round((-owed * 6) / 1200));
  });
});

describe("loan payments", () => {
  const l = year([checking, mortgage], [pay("x1", "2026-04-15", 200000), pay("x2", "2026-05-15", 200000)]);

  it("are suggested into Loan Payments for a transfer into a loan", () => {
    expect(suggestTransferCategory(checking, mortgage, blankSetup(2026))).toBe("ct_loan-payments");
  });

  it("add up on the Loan payments tile, and not in spending", () => {
    expect(summarize(l)).toMatchObject({ loanPayments: 400000, spent: 0 });
    expect(summarize(l, 5).loanPayments).toBe(200000);
  });

  it("flow out of income on their own, not as money left over", () => {
    const l2 = { ...l, earnings: [{ id: "i1", date: "2026-04-01", item: "Pay", amount: 500000, account: "a_checking", cat: "ci_paycheck", notes: "" }] };
    const out = moneyFlow(l2).links.filter((x) => x.source === "hub");
    expect(out).toEqual([{ source: "hub", target: "to-loans", value: 400000 }, { source: "hub", target: "left-over", value: 100000 }]);
  });
});

describe("a loan that began before this year", () => {
  /** $10,000 owed on January 1, at 12% (1% a month), taken out on a 31st. */
  const car: Account = { id: "a_car", name: "Car", type: "loan", ref: "", opening: -1000000, loanStart: "2020-01-31", loanAmount: 2500000, rate: 12 };

  it("opens at what was owed and charges interest on the anniversaries in this year, short months on their last day", () => {
    const l = year([checking, car]);
    expect(loanStatus(l, car, "2026-01-30").balance).toBe(-1000000);
    expect(loanStatus(l, car, "2026-02-27").balance).toBe(-1010000);
    expect(loanStatus(l, car, "2026-03-31")).toEqual({ balance: -1030301, interest: 30301 });
  });

  it("stops charging interest once paid off", () => {
    const l = year([checking, car], [pay("x1", "2026-01-10", 1000000, "a_car")]);
    expect(loanStatus(l, car, "2026-12-31")).toEqual({ balance: 0, interest: 0 });
    expect(accountsOverview(l, "2026-12-31").loans[0]!.owed).toBe(0);
  });
});

describe("setting up a loan", () => {
  const setup = (): YearSetup => ({ ...blankSetup(2026), accounts: [checking] });
  const loan = (over: Partial<Account> = {}): Account => ({ ...mortgage, id: "", ...over });

  it("opens a loan taken out since tracking started at 0", () => {
    const s = saveAccount(setup(), loan({ opening: -5000 }));
    expect(s.accounts[1]).toEqual({ ...mortgage, id: "a_mortgage" });
  });

  it("keeps what an older loan owed when tracking started", () => {
    const s = saveAccount(setup(), loan({ loanStart: "2024-06-01", opening: -25000000 }));
    expect(s.accounts[1]!.opening).toBe(-25000000);
  });

  it("needs a start date, an amount and a rate", () => {
    expect(() => saveAccount(setup(), loan({ loanStart: "2027-01-01" }))).toThrow(SetupError);
    expect(() => saveAccount(setup(), loan({ loanAmount: 0 }))).toThrow("amount borrowed");
    expect(() => saveAccount(setup(), loan({ rate: 120 }))).toThrow("interest rate");
  });

  it("drops loan fields from other account types", () => {
    const s = saveAccount(setup(), { ...checking, id: "", name: "Second", loanStart: "2026-01-01", rate: 5 });
    expect(s.accounts[1]).toEqual({ ...checking, id: "a_second", name: "Second" });
  });

  it("adds a Loan Payments category with the first loan, if the year has none", () => {
    const old = setup();
    const noLoanCat = { ...old, categories: { ...old.categories, transfer: old.categories.transfer.filter((c) => c.role !== "loan_payment") } };
    const s = saveAccount(noLoanCat, loan());
    expect(s.categories.transfer.filter((c) => c.role === "loan_payment")).toEqual([{ id: "ct_loan-payments", name: "Loan Payments", role: "loan_payment" }]);
    // One is enough: a second loan, or saving the first again, adds nothing.
    expect(saveAccount(s, loan({ name: "Car" })).categories).toBe(s.categories);
  });

  it("takes transfers only", () => {
    const s = { ...setup(), accounts: [checking, mortgage] };
    const expense = { ...emptyDraft("expense", "2026-04-01"), item: "x", amount: "10", account: "a_mortgage", cat: "ce_bills" };
    const r = checkDraft(expense, s, "e1");
    expect(r.ok === false && r.errors.account).toMatch(/only takes transfers/);
  });

  it("moves its opening when tracking's start moves past or before it", () => {
    const s = { ...setup(), accounts: [checking, mortgage] };
    const data = { setup: s, expenses: [], earnings: [], transfers: [] };
    // Starting on May 1: owed $300,000 plus April 15's $1,500 interest that morning.
    const may = withStart(data, "2026-05-01");
    expect(may.accounts[1]!.opening).toBe(-30150000);
    // And back to January 1: taken out since, so 0 again.
    expect(withStart({ ...data, setup: may }, null).accounts[1]!.opening).toBe(0);
  });
});

describe("years from before loan payments were transfers", () => {
  it("make a Loan payment expense category regular, on import and when opened", () => {
    const old = blankSetup(2026);
    const withRole = { ...old, categories: { ...old.categories, expense: [...old.categories.expense, { id: "ce_loan", name: "Loan", role: "loan" as never }] } };
    const r = validateYearFile(emptyYearFile(withRole));
    expect(r.ok && r.file.categories.expense.find((c) => c.id === "ce_loan")).toEqual({ id: "ce_loan", name: "Loan" });
    const opened = withoutPeople({ setup: withRole, expenses: [], earnings: [] });
    expect(opened!.setup.categories.expense.find((c) => c.id === "ce_loan")).toEqual({ id: "ce_loan", name: "Loan" });
  });
});

describe("importing a loan", () => {
  const file = (accounts: Account[]) => emptyYearFile({ ...blankSetup(2026), accounts });

  it("accepts a well-formed loan", () => {
    expect(validateYearFile(file([checking, mortgage])).ok).toBe(true);
  });

  it("reports a loan without its details, or one opening above 0 after it began", () => {
    const r = validateYearFile(file([{ ...mortgage, opening: -100, loanAmount: undefined, rate: -1, loanStart: "2026-03-15" }]));
    expect(r.ok === false && r.errors).toEqual([
      `Loan "a_mortgage" began after tracking started, so it must open at 0: its amount is added on its start date.`,
      `Loan "a_mortgage" amount is not whole cents.`,
      `Loan "a_mortgage" interest rate must be a percentage from 0 to 100.`,
    ]);
  });

  it("reports loan fields on an account that isn't a loan", () => {
    const r = validateYearFile(file([{ ...checking, rate: 5 }]));
    expect(r.ok === false && r.errors[0]).toMatch(/isn't a loan/);
  });
});
