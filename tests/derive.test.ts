// Derivations on the synthetic fixture. Every expected number is worked out by hand
// from tests/fixtures/sample-2026.json; the comments show the arithmetic.

import { describe, expect, it } from "vitest";
import {
  accountsOverview, balanceSeries, budgetTarget, countsInNetEarnings, earningsByCategory, forMember, monthsBefore, budgetView, monthProgress, balances, moneyFlow, monthlySummaries, remainingRetirement, spendingOffsetCategories,
  spendByCategory, spendingByMonth, summarize, tagTotal, weeklySpending, weeksOf, type MoneyFlow, type Summary,
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
      loanPayments: 0,
      offsets: 4050, // refunds: 1550 aimed at Food + 500 untargeted; paid back: 2000
      netSpent: 213450, // 217500 − 4050
      netEarnings: 801234, // paychecks 800000 + interest 1234; refunds and paybacks never count
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
    expect(feb.offsets).toBe(4050);

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
  it("nets out targeted offsets", () => {
    const year = spendByCategory(ledger);
    // Food: 8550 + 6000 + 20000 + 450 + 0, minus the 1550 grocery refund.
    expect(year.get("ce_food")).toEqual({ gross: 35000, offsets: 1550, net: 33450 });
    expect(year.get("ce_rent")).toEqual({ gross: 150000, offsets: 0, net: 150000 });
    // Every category is listed, and the untargeted 500 refund is in no row.
    expect([...year.keys()].sort()).toEqual(["ce_charity", "ce_food", "ce_loan", "ce_rent"]);
    const offsetsInRows = [...year.values()].reduce((s, r) => s + r.offsets, 0);
    expect(offsetsInRows).toBe(1550);
  });

  it("can go below zero when a refund lands in a quiet month", () => {
    expect(spendByCategory(ledger, 2).get("ce_food")!.net).toBe(450 - 1550);
  });
});

describe("net earnings", () => {
  it("leaves out income categories switched off", () => {
    const l = sample();
    l.categories.earning = l.categories.earning.map((c) => (c.id === "ci_interest" ? { ...c, net: false } : c));
    expect(summarize(l).netEarnings).toBe(800000);
  });

  it("only paycheck and income roles can count", () => {
    expect(countsInNetEarnings({ role: "paycheck" })).toBe(true);
    expect(countsInNetEarnings({ role: "income", net: false })).toBe(false);
    expect(countsInNetEarnings({ role: "offset", net: true })).toBe(false);
  });
});

describe("net spending", () => {
  it("is lowered only by earnings in Lowers spending categories", () => {
    expect([...spendingOffsetCategories(ledger)].sort()).toEqual(["ci_payback", "ci_refunds"]);

    const l = sample();
    l.categories.earning = [
      ...l.categories.earning.map((c) => (c.id === "ci_interest" ? { ...c, net: false } : c)),
      { id: "ci_uncategorized", name: "Uncategorized", role: "income", net: false },
    ];
    l.earnings.push({ id: "i9", date: "2026-03-01", item: "Mystery", amount: 7000, account: "a_checking", cat: "ci_uncategorized", notes: "" });
    expect([...spendingOffsetCategories(l)].sort()).toEqual(["ci_payback", "ci_refunds"]);
    const s = summarize(l);
    // Unticked interest and Uncategorized count in neither figure.
    expect(s.offsets).toBe(4050);
    expect(s.netSpent).toBe(217500 - 4050);
    expect(s.netEarnings).toBe(800000);
  });
});

describe("earningsByCategory", () => {
  it("sums each earning category, listing all of them", () => {
    expect(Object.fromEntries(earningsByCategory(ledger))).toEqual({
      ci_paycheck: 800000, ci_interest: 1234, ci_refunds: 2050, ci_payback: 2000,
    });
    expect(earningsByCategory(ledger, 1).get("ci_refunds")).toBe(0);
    const total = [...earningsByCategory(ledger).values()].reduce((a, b) => a + b, 0);
    expect(total).toBe(summarize(ledger).earned);
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

describe("report series", () => {
  it("spending per category per month", () => {
    const m = spendingByMonth(ledger);
    expect(m.get("ce_food")!.slice(0, 3)).toEqual([34550, 450, 0]); // 8550 + 6000 + 20000; 450 + 0
    expect(m.get("ce_rent")![0]).toBe(150000);
    expect(m.get("ce_loan")![1]).toBe(30000);
  });

  it("weeks run Monday to Sunday and cover the whole year", () => {
    const w = weeksOf(2026); // Jan 1 2026 is a Thursday
    expect(w).toHaveLength(53);
    expect(w[0]).toEqual({ start: "2025-12-29", end: "2026-01-04" });
    expect(w.at(-1)).toEqual({ start: "2026-12-28", end: "2027-01-03" });
  });

  it("weekly spending by source adds up to the year", () => {
    const weeks = weeklySpending(ledger, 2026);
    expect(weeks[0]!.bySource).toEqual({ bank: 150000, card: 8550, cash: 0 }); // rent Jan 1, groceries Jan 3
    const total = weeks.reduce((s, w) => s + w.bySource.bank + w.bySource.card + w.bySource.cash, 0);
    expect(total).toBe(summarize(ledger).spent);
  });

  it("account totals over time", () => {
    expect(balanceSeries(ledger, ["2026-01-31", "2026-12-31"])).toEqual([
      // Jan 31: checking 560000 + savings 1101234 + wallet 0; card −20000 − 14550 + 20000
      { date: "2026-01-31", availableCash: 1661234, cardDebt: 14550, loanDebt: 0, netTangibleAssets: 1646684, invested: 50000, saved: 100000 },
      // 100000 in, then 25000 taken out on Feb 16
      { date: "2026-12-31", availableCash: 2032784, cardDebt: 15000, loanDebt: 0, netTangibleAssets: 2017784, invested: 50000, saved: 75000 },
    ]);
  });
});

describe("moneyFlow", () => {
  /** Total flowing into and out of the hub. */
  const sides = (f: MoneyFlow) => ({
    in: f.links.filter((l) => l.target === "hub").reduce((s, l) => s + l.value, 0),
    out: f.links.filter((l) => l.source === "hub").reduce((s, l) => s + l.value, 0),
  });
  const value = (f: MoneyFlow, id: string) => f.links.find((l) => l.source === id || l.target === id)?.value;

  it("balances the year: income in, spending, saving, investing and left-over out", () => {
    const f = moneyFlow(ledger);
    expect(sides(f)).toEqual({ in: 805284, out: 805284 });
    expect(value(f, "ci_paycheck")).toBe(800000);
    expect(value(f, "ce_rent")).toBe(150000);
    expect(value(f, "to-savings")).toBe(75000);
    expect(value(f, "to-retirement")).toBe(50000);
    expect(value(f, "left-over")).toBe(805284 - 217500 - 75000 - 50000);
    expect(value(f, "from-savings")).toBeUndefined();
    expect(f.links.every((l) => l.value > 0)).toBe(true);
  });

  it("shows money taken out of savings as an inflow", () => {
    const f = moneyFlow(ledger, 2); // February: 25000 taken out of savings
    expect(value(f, "from-savings")).toBe(25000);
    expect(value(f, "to-savings")).toBeUndefined();
    expect(sides(f)).toEqual({ in: 404050 + 25000, out: 404050 + 25000 });
  });

  it("draws on balances when outflows beat income", () => {
    const tight = sample();
    tight.earnings = [];
    const f = moneyFlow(tight);
    expect(value(f, "drawn")).toBe(217500 + 75000 + 50000);
    expect(sides(f).in).toBe(sides(f).out);
  });

  it("is just the hub for an empty month", () => {
    expect(moneyFlow(ledger, 3)).toEqual({ nodes: [{ id: "hub", name: "Income", group: "hub" }], links: [] });
  });
});

describe("budgets", () => {
  // Fixture budgets: Food 400/month, Rent 1500/month; February overrides Food to 500.
  const budgets = ledger.budgets;

  it("uses a month's override, else the usual target", () => {
    expect(budgetTarget(budgets, 2026, 1, "ce_food")).toBe(40000);
    expect(budgetTarget(budgets, 2026, 2, "ce_food")).toBe(50000);
    expect(budgetTarget(budgets, 2026, 2, "ce_rent")).toBe(150000);
    expect(budgetTarget(budgets, 2026, 2, "ce_loan")).toBeUndefined();
    // A partly tracked month scales the usual target, never the month's own.
    expect(budgetTarget(budgets, 2026, 1, "ce_food", 0.5)).toBe(20000);
    expect(budgetTarget(budgets, 2026, 2, "ce_food", 0.5)).toBe(50000);
  });

  it("compares one month, net of refunds", () => {
    const jan = budgetView(ledger, budgets, 2026, [1]);
    const food = jan.lines.find((l) => l.cat === "ce_food")!;
    // Food in January: 8550 + 6000 + 20000.
    expect(food).toEqual({ cat: "ce_food", target: 40000, overridden: false, spent: 34550, remaining: 5450 });
    expect(jan.lines.find((l) => l.cat === "ce_loan")).toMatchObject({ target: undefined, remaining: undefined });
    expect(jan.budgeted).toBe(190000);

    const feb = budgetView(ledger, budgets, 2026, [2]);
    // February: 450 spent, 1550 refund aimed at Food; the 500 store credit and 2000 paid back aren't aimed anywhere.
    expect(feb.lines.find((l) => l.cat === "ce_food")).toMatchObject({ target: 50000, overridden: true, spent: -1100 });
    expect(feb.untargetedOffsets).toBe(2500);
    expect(feb.spentUnbudgeted).toBe(2500 + 30000); // charity and loan have no budget
  });

  it("adds targets up over several months", () => {
    const ytd = budgetView(ledger, budgets, 2026, [1, 2]);
    expect(ytd.lines.find((l) => l.cat === "ce_food")!.target).toBe(90000);
    expect(ytd.lines.find((l) => l.cat === "ce_food")!.overridden).toBe(false);
    expect(ytd.budgeted).toBe(90000 + 300000);
  });

  it("totals match net spending", () => {
    for (const months of [[1], [2], [3], [1, 2, 3]]) {
      const v = budgetView(ledger, budgets, 2026, months);
      const want = months.reduce((a, m) => a + summarize(ledger, m).netSpent, 0);
      expect(v.netSpent, String(months)).toBe(want);
    }
  });

  it("knows how far through the month today is", () => {
    expect(monthProgress(2026, 4, "2026-04-15")).toBe(0.5);
    expect(monthProgress(2026, 4, "2026-05-01")).toBeNull();
  });
});

describe("monthsBefore", () => {
  it.each([
    ["2026-10-24", 1, "2026-09-24"],
    ["2026-10-24", 12, "2025-10-24"],
    ["2026-02-15", 3, "2025-11-15"],
    ["2026-03-31", 1, "2026-02-28"], // February has no 31st
    ["2024-03-30", 1, "2024-02-29"], // leap year
  ])("%s minus %i months is %s", (date, n, want) => {
    expect(monthsBefore(date, n)).toBe(want);
  });
});

describe("forMember", () => {
  // Riya logged the grocery run and the card payment; everything else is the default person's.
  const l = sample();
  l.expenses = l.expenses.map((e) => (e.id === "e0002" ? { ...e, member: "m_riya" } : e));
  l.transfers = l.transfers.map((t) => (t.id === "x0001" ? { ...t, member: "m_riya" } : t));
  const riya = forMember(l, "m_riya", "m_person-a");
  const a = forMember(l, "m_person-a", "m_person-a");

  it("keeps only that person's entries, and every account", () => {
    expect(riya.expenses.map((e) => e.id)).toEqual(["e0002"]);
    expect(riya.transfers.map((t) => t.id)).toEqual(["x0001"]);
    expect(riya.earnings).toEqual([]);
    expect(riya.accounts).toBe(l.accounts);
    expect(a.expenses).toHaveLength(l.expenses.length - 1);
  });

  it("everyone's figures add up to the household's", () => {
    const all = summarize(l), sa = summarize(a), sr = summarize(riya);
    for (const key of ["earned", "spent", "offsets", "netSpent", "netEarnings", "ccPayments", "netSavings", "investment"] as const) {
      expect(sa[key] + sr[key], key).toBe(all[key]);
    }
    expect(sr.spent).toBe(8550);
    expect(sr.ccPayments).toBe(20000);
  });
});
