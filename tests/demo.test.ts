import { beforeEach, describe, expect, it } from "vitest";
import { exportYear, importYear } from "../src/backup";
import { accountsOverview, balances, countsInNetEarnings, summarize } from "../src/derive";
import { demoFileName, demoYear } from "../src/demo";
import { iraLimitOf } from "../src/setup";
import type { YearFile } from "../src/types";
import { validateYearFile } from "../src/validate";
import { freshDb } from "./helpers";

beforeEach(freshDb);

/** The demo's "today" in these tests, so they don't change from day to day. */
const NOW = new Date(2026, 9, 26);
const entries = (f: YearFile) => [...f.expenses, ...f.earnings, ...f.transfers];
const lastDay = (m: number, year: number) => new Date(Date.UTC(year, m, 0)).toISOString().slice(0, 10);

describe("the demo file", () => {
  it("is a valid year file in any year", () => {
    for (const year of [2024, 2026, 2031]) {
      const r = validateYearFile(demoYear(year, NOW));
      expect(r.ok ? [] : r.errors).toEqual([]);
    }
  });

  it("runs to today in the current year, all year in a past one, and only January in a future one", () => {
    const months = (f: YearFile) => [...new Set(entries(f).map((e) => Number(e.date.slice(5, 7))))].sort((a, b) => a - b);
    const now = demoYear(2026, NOW);
    expect(months(now)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(entries(now).every((e) => e.date <= "2026-10-26")).toBe(true);
    expect(now.accounts.flatMap((a) => a.valuations ?? []).every((v) => v.date <= "2026-10-26")).toBe(true);
    expect(months(demoYear(2025, NOW))).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(months(demoYear(2031, NOW))).toEqual([1]);
    // Nothing is closed before the day it happens.
    expect(demoYear(2026, new Date(2026, 1, 10)).accounts.some((a) => a.closedOn)).toBe(false);
  });

  it("shows a mix: every account type, the ways an account ends, both people, tags, refunds and one-offs", () => {
    const f = demoYear(2025, NOW);
    expect(new Set(f.accounts.map((a) => a.type))).toEqual(new Set(["checking", "savings", "credit", "cash", "investment", "loan", "asset"]));
    const byId = new Map(f.accounts.map((a) => [a.id, a]));
    expect(byId.get("a_old-savings")!.closedOn).toBe("2025-03-31");
    expect(byId.get("a_motorcycle")!.closedOn).toBe("2025-04-12");
    expect(byId.get("a_store-card")).toMatchObject({ archived: true });
    expect(byId.get("a_store-card")!.closedOn).toBeUndefined();
    expect(["a_ira", "a_brokerage", "a_car"].every((id) => byId.get(id)!.valuations!.length > 1)).toBe(true);
    expect(f.members!.map((m) => m.id)).toEqual(["m_person-a", "m_john"]);
    expect(entries(f).some((e) => e.member === "m_john")).toBe(true);
    expect(new Set(f.expenses.flatMap((e) => e.tags))).toEqual(new Set(["t_groceries", "t_date-night", "t_vacation", "t_holidays"]));
    expect(new Set(f.earnings.filter((e) => e.offsets !== undefined).map((e) => e.offsets))).toEqual(new Set(["ce_shopping", "ce_personal-care-activities", null]));
    const cats = f.categories.earning;
    // Incomes left out of net earnings on purpose: the gift and the motorcycle sale.
    expect(f.earnings.filter((e) => {
      const c = cats.find((x) => x.id === e.cat)!;
      return c.role === "income" && !countsInNetEarnings(c);
    }).map((e) => e.item)).toEqual(["Birthday gift from Grandma", "Sold the motorcycle"]);
    const roles = new Set(f.transfers.map((t) => f.categories.transfer.find((c) => c.id === t.cat)!.role));
    expect(roles).toEqual(new Set(["savings_in", "savings_out", "invest_retirement", "invest_taxable", "cash_withdrawal", "cc_payment", "loan_payment", "general"]));
  });

  it("adds up to sensible balances all year", () => {
    const f = demoYear(2025, NOW);
    for (let m = 1; m <= 12; m++) {
      const day = lastDay(m, 2025), bal = balances(f, day), o = accountsOverview(f, day, "2026-10-26");
      for (const a of f.accounts.filter((x) => ["checking", "savings", "cash"].includes(x.type))) {
        expect(bal.get(a.id)!, `${a.name} on ${day}`).toBeGreaterThanOrEqual(0);
      }
      // The card is paid every month and never near its limit.
      expect(o.utilization!, `card use on ${day}`).toBeLessThan(0.5);
      expect(o.netWorth, `net worth on ${day}`).toBeGreaterThan(0);
    }
    // The closed savings account closed at 0, so its money moved rather than vanished.
    expect(balances(f, "2025-03-31").get("a_old-savings")).toBe(0);
    const end = balances(f, "2025-12-31");
    expect(-end.get("a_car-loan")!).toBeLessThan(2180000);
    expect(summarize(f).surplus).toBeGreaterThan(0);
    // IRA contributions stay within the year's limit.
    expect(summarize(f).investRetirement).toBeLessThanOrEqual(iraLimitOf({ year: 2025 }));
  });

  it("imports and backs up like any year", async () => {
    const f = demoYear(2026, NOW);
    expect(await importYear(f)).toMatchObject({ ok: true });
    const back = (await exportYear(2026))!;
    expect(back.expenses).toHaveLength(f.expenses.length);
    expect(back.accounts).toEqual(f.accounts);
    expect(demoFileName(2026)).toBe("money-tracker-demo-2026.json");
  });
});
