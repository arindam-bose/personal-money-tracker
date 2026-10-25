import { beforeEach, describe, expect, it } from "vitest";
import { exportYear, importYear } from "../src/backup";
import { balances, countsInNetEarnings, summarize } from "../src/derive";
import { demoFileName, demoYear } from "../src/demo";
import { validateYearFile } from "../src/validate";
import { freshDb } from "./helpers";

beforeEach(freshDb);

describe("the demo file", () => {
  it("is a valid year file in any year", () => {
    for (const year of [2024, 2026, 2031]) {
      const r = validateYearFile(demoYear(year));
      expect(r.ok ? [] : r.errors).toEqual([]);
    }
  });

  it("has a handful of each kind of entry", () => {
    const f = demoYear(2026);
    expect([f.expenses.length, f.earnings.length, f.transfers.length]).toEqual([6, 5, 5]);
  });

  it("shows a mix: every account type, both people, tags, a refund and a one-off", () => {
    const f = demoYear(2026);
    expect(new Set(f.accounts.map((a) => a.type))).toEqual(new Set(["checking", "savings", "credit", "cash", "investment"]));
    expect(f.members!.length).toBe(2);
    expect([...f.expenses, ...f.earnings, ...f.transfers].some((e) => e.member === "m_john")).toBe(true);
    expect(f.expenses.some((e) => e.tags.length > 0)).toBe(true);
    expect(f.earnings.some((e) => e.offsets === "ce_shopping")).toBe(true);
    const cats = f.categories.earning;
    // An income left out of net earnings on purpose: the one-off gift.
    expect(f.earnings.some((e) => {
      const c = cats.find((x) => x.id === e.cat)!;
      return c.role === "income" && !countsInNetEarnings(c);
    })).toBe(true);
    const roles = new Set(f.transfers.map((t) => f.categories.transfer.find((c) => c.id === t.cat)!.role));
    expect(roles).toEqual(new Set(["savings_in", "invest_retirement", "cash_withdrawal", "cc_payment", "invest_taxable"]));
  });

  it("adds up to sensible balances: nothing overdrawn, the card owes less than it did", () => {
    const f = demoYear(2026);
    const bal = balances(f);
    for (const a of f.accounts.filter((x) => x.type !== "credit")) expect(bal.get(a.id)!).toBeGreaterThanOrEqual(0);
    expect(bal.get("a_card")!).toBeGreaterThan(-45000);
    expect(summarize(f).surplus).toBeGreaterThan(0);
  });

  it("imports and backs up like any year", async () => {
    expect(await importYear(demoYear(2026))).toMatchObject({ ok: true });
    const back = (await exportYear(2026))!;
    expect(back.expenses).toHaveLength(6);
    expect(demoFileName(2026)).toBe("money-tracker-demo-2026.json");
  });
});
