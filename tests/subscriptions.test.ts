// Subscriptions: expenses with the Subscription tag, grouped by name, with how often they're paid.

import { describe, expect, it } from "vitest";
import { subscriptionTag, subscriptions } from "../src/derive";
import type { Expense } from "../src/types";
import { sample } from "./helpers";

const SUB = "t_sub";
let n = 0;
const pay = (date: string, item: string, amount: number, tags = [SUB]): Expense =>
  ({ id: `e_s${++n}`, date, item, amount, account: "a_card", cat: "ce_food", tags, notes: "" });

function ledgerWith(expenses: Expense[]) {
  const l = sample();
  l.tags.push({ id: SUB, name: "Subscription" });
  l.expenses.push(...expenses);
  return l;
}

describe("subscriptionTag", () => {
  it("finds Subscription or Subscriptions, in any case", () => {
    expect(subscriptionTag([{ id: "a", name: "TV" }, { id: "b", name: " subscriptions " }])?.id).toBe("b");
    expect(subscriptionTag([{ id: "a", name: "Subscription boxes" }])).toBeUndefined();
  });
});

describe("subscriptions", () => {
  const l = ledgerWith([
    pay("2026-01-23", "Netflix", 847), pay("2026-02-23", "netflix ", 847), pay("2026-03-23", "Netflix", 953),
    pay("2026-01-25", "Spotify", 1801), pay("2026-02-26", "Spotify", 2013),
    pay("2026-02-22", "Costco yearly membership", 3125),
    pay("2026-01-10", "Notion", 12720),
    pay("2026-01-05", "Claude monthly", 2120),
    pay("2026-02-01", "Not a subscription", 9999, []),
  ]);
  const subs = subscriptions(l, SUB, "2026-03-31");
  const byName = new Map(subs.map((s) => [s.name, s]));

  it("groups by name, ignoring case and spacing, and leaves untagged entries out", () => {
    expect(subs.map((s) => s.name).sort()).toEqual(["Claude monthly", "Costco yearly membership", "Netflix", "Notion", "Spotify"]);
    const netflix = byName.get("Netflix")!;
    expect(netflix).toMatchObject({ payments: 3, total: 2647, first: "2026-01-23", last: "2026-03-23", lastAmount: 953, cadence: "monthly", active: true });
    expect(netflix.byMonth.slice(0, 3)).toEqual([847, 847, 953]);
  });

  it("prices a year at the latest payment", () => {
    expect(byName.get("Netflix")!.yearlyCost).toBe(953 * 12);
    expect(byName.get("Costco yearly membership")).toMatchObject({ cadence: "yearly", yearlyCost: 3125, active: true });
    expect(byName.get("Notion")).toMatchObject({ cadence: "once", yearlyCost: 12720, active: true });
  });

  it("stops a monthly one that missed its next payment", () => {
    // Spotify last paid Feb 26: 33 days before Mar 31, still active. Claude monthly, Jan 5: 85 days, stopped.
    expect(byName.get("Spotify")!.active).toBe(true);
    expect(byName.get("Claude monthly")).toMatchObject({ cadence: "monthly", active: false, yearlyCost: 0 });
  });

  it("puts the biggest yearly cost first", () => {
    expect(subs[0]!.name).toBe("Spotify"); // 2013 × 12 = 24156
    expect(subs[subs.length - 1]!.name).toBe("Claude monthly");
  });

  it("ignores payments after the day it's judged on", () => {
    expect(subscriptions(l, SUB, "2026-01-31").find((s) => s.name === "Netflix")).toMatchObject({ payments: 1, cadence: "once" });
  });
});
