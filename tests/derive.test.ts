// Derivations on the synthetic fixture. Every expected number is worked out by hand
// from tests/fixtures/sample-2026.json; the comments show the arithmetic.

import { describe, expect, it } from "vitest";
import {
  accountsOverview, balances, monthlySummaries, receivables, remainingRetirement,
  spendByCategory, summarize, tagTotal, type Summary,
} from "../src/derive";
import { sample } from "./helpers";

const ledger = sample();

describe("summarize", () => {
  it("adds up the whole year", () => {
    expect(summarize(ledger)).toEqual({
      earned: 805284, // 400000 + 1234 + 1550 + 500 + 2000 + 400000
      paycheck: 800000,
      otherEarned: 5284,
      spent: 217500, // 150000 + 8550 + 6000 + 20000 + 450 + 2500 + 30000 + 0
      spentBySource: { bank: 200000, card: 17050, cash: 450 }, // the loan came from savings: still "bank"
      surplus: 587784,
      ccPayments: 20000,
      netSavings: 75000, // 100000 in − 25000 out
      investRetirement: 50000,
      investTaxable: 0,
      investment: 50000,
      charity: 2500,
      loan: 30000,
      offsets: 2050, // 1550 aimed at Food + 500 untargeted
      reimbursed: 2000,
      owed: 3000,
      netSpent: 212450, // 217500 − 2050 − 3000
      netIncome: 801234, // 805284 − 2050 − 2000
      savingsRate: 75000 / 800000,
      investmentRate: 50000 / 800000,
      charityRate: 2500 / 800000,
    } satisfies Summary);
  });

  it("splits by month", () => {
    const jan = summarize(ledger, 1);
    expect(jan.spent).toBe(184550);
    expect(jan.spentBySource).toEqual({ bank: 170000, card: 14550, cash: 0 });
    expect(jan.earned).toBe(401234);
    expect(jan.netSavings).toBe(100000);

    const feb = summarize(ledger, 2);
    expect(feb.spentBySource).toEqual({ bank: 30000, card: 2500, cash: 450 });
    expect(feb.netSavings).toBe(-25000);
    expect(feb.offsets).toBe(2050);

    const mar = summarize(ledger, 3);
    expect(mar.earned).toBe(0);
    expect(mar.savingsRate).toBeNull(); // no paycheck, so no rate
  });

  it("months add up to the year for every amount", () => {
    const year = summarize(ledger);
    const months = monthlySummaries(ledger);
    expect(months).toHaveLength(12);
    for (const key of Object.keys(year) as (keyof Summary)[]) {
      const value = year[key];
      if (typeof value !== "number" || key.endsWith("Rate")) continue;
      expect(months.reduce((s, m) => s + (m[key] as number), 0), key).toBe(value);
    }
  });
});

describe("tagTotal", () => {
  it("sums expenses with a tag", () => {
    expect(tagTotal(ledger, "t_abroad")).toBe(20000);
    expect(tagTotal(ledger, "t_grocery", 1)).toBe(8550);
    expect(tagTotal(ledger, "t_grocery", 2)).toBe(0);
  });
});

describe("spendByCategory", () => {
  it("nets out owed shares and targeted offsets", () => {
    const year = spendByCategory(ledger);
    // Food: 8550 + 6000 + 20000 + 450 + 0, minus Sam's 3000, minus the 1550 grocery refund.
    expect(year.get("ce_food")).toEqual({ gross: 35000, owed: 3000, offsets: 1550, net: 30450 });
    expect(year.get("ce_rent")).toEqual({ gross: 150000, owed: 0, offsets: 0, net: 150000 });
    // Every category is listed, and the untargeted 500 refund is in no row.
    expect([...year.keys()].sort()).toEqual(["ce_charity", "ce_food", "ce_loan", "ce_rent"]);
    const offsetsInRows = [...year.values()].reduce((s, r) => s + r.offsets, 0);
    expect(offsetsInRows).toBe(1550);
  });

  it("can go below zero when a refund lands in a quiet month", () => {
    expect(spendByCategory(ledger, 2).get("ce_food")!.net).toBe(450 - 1550);
  });
});

describe("accounts", () => {
  it("computes balances with the net-worth sign", () => {
    expect(Object.fromEntries(balances(ledger))).toEqual({
      a_checking: 983000,
      a_savings: 1046234, // 1000000 − 30000 + 1234 + 100000 − 25000
      a_wallet: 3550, // 4000 withdrawn − 450 spent
      a_card: -15000, // −20000 − 17050 spent + 2050 refunds + 20000 paid
      a_ira: 50000,
    });
  });

  it("balances change only by the surplus, because transfers net to zero", () => {
    const opening = ledger.accounts.reduce((s, a) => s + a.opening, 0);
    const closing = [...balances(ledger).values()].reduce((s, b) => s + b, 0);
    expect(closing - opening).toBe(summarize(ledger).surplus);
  });

  it("computes balances on a given day", () => {
    // Through Jan 31: 500000 − 150000 − 20000 + 400000 − 20000 − 100000 − 50000
    expect(balances(ledger, "2026-01-31").get("a_checking")).toBe(560000);
  });

  it("summarizes cash, debt and utilization", () => {
    const o = accountsOverview(ledger);
    expect(o.availableCash).toBe(983000 + 1046234 + 3550);
    expect(o.cardDebt).toBe(15000);
    expect(o.cardLimit).toBe(500000);
    expect(o.utilization).toBe(0.03);
    expect(o.netTangibleAssets).toBe(2032784 - 15000);
    expect(o.cards).toEqual([{ account: ledger.accounts[3], debt: 15000, utilization: 0.03 }]);
    expect(Object.fromEntries(o.invested)).toEqual({ a_ira: 50000 });
  });

  it("shows a paid-off card as no debt", () => {
    const paid = sample();
    paid.transfers.push({
      id: "x9", date: "2026-03-01", item: "Overpay", amount: 20000,
      from: "a_checking", to: "a_card", cat: "ct_cc", notes: "",
    });
    const card = accountsOverview(paid).cards[0]!;
    expect(card.debt).toBe(0);
    expect(card.utilization).toBe(0);
  });

  it("caps remaining retirement room at zero", () => {
    expect(remainingRetirement(ledger, 750000)).toBe(700000);
    expect(remainingRetirement(ledger, 40000)).toBe(0);
  });
});

describe("receivables", () => {
  it("is what each person owes minus what they paid back", () => {
    expect(Object.fromEntries(receivables(ledger))).toEqual({ p_sam: 1000 }); // 3000 owed − 2000 back
  });
});
