// Subscriptions: expenses with the Subscription tag, grouped by name, with how often they're paid.

import { describe, expect, it } from "vitest";
import { itemKey, subscriptionTags, subscriptions, taggedWith } from "../src/derive";
import type { Expense } from "../src/types";

let n = 0;
const pay = (date: string, item: string, amount: number, tags = ["t_sub"]): Expense =>
  ({ id: `e_s${++n}`, date, item, amount, account: "a_card", cat: "ce_bills", tags, notes: "" });
const monthly = (item: string, amount: number, day: number, from: number, to: number, year = 2026) =>
  Array.from({ length: to - from + 1 }, (_, i) => pay(`${year}-${String(from + i).padStart(2, "0")}-${String(day).padStart(2, "0")}`, item, amount));
const byName = (list: ReturnType<typeof subscriptions>) => new Map(list.map((s) => [s.name, s]));

describe("subscriptionTags and taggedWith", () => {
  it("finds every tag named Subscription or Subscriptions, in any case", () => {
    const tags = [{ id: "a", name: "TV" }, { id: "b", name: " subscriptions " }, { id: "c", name: "Subscription" }, { id: "d", name: "Subscription boxes" }];
    expect(subscriptionTags(tags).map((t) => t.id)).toEqual(["b", "c"]);
  });

  it("picks out the expenses with any of them", () => {
    const list = [pay("2026-01-01", "A", 1, ["b"]), pay("2026-01-01", "B", 1, ["c", "x"]), pay("2026-01-01", "C", 1, ["x"])];
    expect(taggedWith(list, [{ id: "b", name: "" }, { id: "c", name: "" }]).map((e) => e.item)).toEqual(["A", "B"]);
  });

  it("matches names ignoring case and spacing", () => {
    expect(itemKey("  Netflix   Premium ")).toBe(itemKey("netflix premium"));
  });
});

describe("subscriptions", () => {
  const subs = subscriptions([
    pay("2026-01-23", "Netflix", 847), pay("2026-02-23", "netflix ", 847), pay("2026-03-23", "Netflix", 953),
    pay("2026-01-25", "Spotify", 1801), pay("2026-02-26", "Spotify", 2013),
    pay("2026-02-22", "Costco yearly membership", 3125),
    pay("2026-01-10", "Notion", 12720),
    pay("2026-01-05", "Claude monthly", 2120),
  ], "2026-03-31");
  const s = byName(subs);

  it("groups by name, ignoring case and spacing", () => {
    expect(subs.map((x) => x.name).sort()).toEqual(["Claude monthly", "Costco yearly membership", "Netflix", "Notion", "Spotify"]);
    expect(s.get("Netflix")).toMatchObject({ payments: 3, total: 2647, last: "2026-03-23", lastAmount: 953, cadence: "monthly", active: true });
    expect(s.get("Netflix")!.byMonth.slice(0, 3)).toEqual([847, 847, 953]);
  });

  it("prices a year at the latest payment", () => {
    expect(s.get("Netflix")!.yearlyCost).toBe(953 * 12);
    expect(s.get("Costco yearly membership")).toMatchObject({ cadence: "yearly", yearlyCost: 3125, active: true });
    // Paid once 80 days ago: it would have come back by now if it were monthly, so it's yearly.
    expect(s.get("Notion")).toMatchObject({ cadence: "once", yearlyCost: 12720, active: true });
  });

  it("stops one that missed its next payment", () => {
    // Spotify, Feb 26: 33 days before Mar 31, inside 1.5 months. Claude monthly, Jan 5: 85 days, stopped.
    expect(s.get("Spotify")!.active).toBe(true);
    expect(s.get("Claude monthly")).toMatchObject({ cadence: "monthly", active: false, yearlyCost: 0 });
  });

  it("puts the biggest yearly cost first", () => {
    expect(subs[0]!.name).toBe("Spotify"); // 2013 × 12 = 24156
    expect(subs[subs.length - 1]!.name).toBe("Claude monthly");
  });

  it("leaves out payments after the day it's judged on", () => {
    expect(byName(subscriptions([pay("2026-01-23", "Netflix", 847), pay("2026-02-23", "Netflix", 847)], "2026-01-31")).get("Netflix"))
      .toMatchObject({ payments: 1, cadence: "new" });
  });

  it("can't tell how often a single recent payment comes, so it isn't priced", () => {
    // January 20: three subscriptions paid once each, no last year to go on.
    const jan = subscriptions([pay("2026-01-05", "Netflix", 1599), pay("2026-01-08", "Spotify", 1199), pay("2026-01-05", "Internet", 6500)], "2026-01-20");
    expect(jan.every((x) => x.cadence === "new" && x.active && x.yearlyCost === null)).toBe(true);
  });

  it("learns how often from last year's payments, and counts only this year's", () => {
    const earlier = [...monthly("Netflix", 1599, 5, 1, 12, 2025), pay("2025-05-02", "Domain name", 2000), ...monthly("Old app", 500, 1, 1, 6, 2025)];
    const jan = byName(subscriptions([pay("2026-01-05", "Netflix", 1599)], "2026-01-20", earlier));
    expect(jan.get("Netflix")).toMatchObject({ cadence: "monthly", payments: 1, total: 1599, active: true, yearlyCost: 1599 * 12 });
    // Paid once last May: still running, though nothing yet this year.
    expect(jan.get("Domain name")).toMatchObject({ cadence: "once", payments: 0, total: 0, last: "2025-05-02", active: true, yearlyCost: 2000 });
    // Monthly until last June, nothing since: stopped last year, so it's left out.
    expect(jan.has("Old app")).toBe(false);
  });

  it("knows twice a year, every two months and weekly, each with its own grace", () => {
    const list = [
      pay("2026-01-10", "Car insurance", 60000), pay("2026-07-10", "Car insurance", 60000),
      pay("2026-02-01", "Magazine", 900), pay("2026-04-01", "Magazine", 900), pay("2026-06-01", "Magazine", 900),
      ...[1, 8, 15, 22, 29].map((d) => pay(`2026-03-${String(d).padStart(2, "0")}`, "Meal kit", 6000)),
    ];
    const dec = byName(subscriptions(list, "2026-12-01"));
    // 144 days after July 10: not due until January, so still active. The magazine, due Aug 1, is four months late.
    expect(dec.get("Car insurance")).toMatchObject({ cadence: "twice-yearly", active: true, yearlyCost: 120000 });
    expect(dec.get("Magazine")).toMatchObject({ cadence: "bimonthly", active: false });
    expect(dec.get("Meal kit")).toMatchObject({ cadence: "weekly", active: false });
    // A week after the last meal kit it's still running, at 52 and a bit a year.
    expect(byName(subscriptions(list, "2026-04-05")).get("Meal kit")).toMatchObject({ active: true, yearlyCost: Math.round(6000 * 365.25 / 7) });
  });

  it("prices an irregular one at its typical gap", () => {
    // Every 130 days: about 2.8 payments a year, not the 4 the span would suggest.
    const list = [0, 130, 260].map((d) => pay(new Date(Date.UTC(2026, 0, 1 + d)).toISOString().slice(0, 10), "Water delivery", 3000));
    const w = subscriptions(list, "2026-10-01")[0]!;
    expect(w).toMatchObject({ cadence: "irregular", active: true, yearlyCost: Math.round(3000 * 365.25 / 130) });
  });
});
