// Runs only when your real, git-ignored data is present. Nothing here is committed with
// real numbers in it: every expected figure is read from Notion's own export at test time.
//
// Each year found as data/money-tracker-<year>.json is checked; the Notion comparison also
// needs that year's export in data/Notion-<year>/.

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { exportYear, importYear } from "../src/backup";
import {
  accountsOverview, balanceSeries, balances, budgetView, moneyFlow, spendByCategory, summarize, tagTotal, weeklySpending,
  type Ledger, type Summary,
} from "../src/derive";
import { checkDraft, draftFrom, type AnyEntry } from "../src/entries";
import { nextYearSetup } from "../src/rollover";
import { iraLimitOf } from "../src/setup";
import type { YearFile } from "../src/types";
import { validateYearFile } from "../src/validate";
import { freshDb, loadJson } from "./helpers";
import { asNotionSaw, notionCents, readNotionTable } from "./notion";

const jsonPath = (year: number) => `../data/money-tracker-${year}.json`;
const notionDir = (year: number) => fileURLToPath(new URL(`../data/Notion-${year}`, import.meta.url));
const has = (path: string) => existsSync(new URL(path, import.meta.url));

/** Every year with a data file, oldest first. */
const YEARS = Array.from({ length: 30 }, (_, i) => 2010 + i).filter((y) => has(jsonPath(y)));

describe.skipIf(YEARS.length === 0).each(YEARS)("real %i data", (year) => {
  const load = (): YearFile => loadJson(jsonPath(year));
  const ledger: Ledger = load();

  describe("file and storage", () => {
    beforeEach(freshDb);

    it("is a valid year file", () => {
      const r = validateYearFile(load());
      expect(r.ok ? [] : r.errors).toEqual([]);
    });

    it("round-trips through IndexedDB unchanged", async () => {
      const file = load();
      await importYear(file);
      const out = (await exportYear(year))!;
      expect(out.expenses).toHaveLength(file.expenses.length);
      // Importing brings an older file up to date (an old loan expense role, say), so compare with that.
      const r = validateYearFile(file);
      const upgraded = r.ok ? r.file : file;
      // Files made before the IRA limit was saved per year get the IRS limit for their year.
      expect({ ...out, exportedAt: "" }).toEqual({ ...upgraded, exportedAt: "", iraLimit: file.iraLimit ?? iraLimitOf(file) });
    });

    it("every entry opens in the form and saves back unchanged", () => {
      const file = load();
      const setup = { ...file };
      const all: AnyEntry[] = [
        ...file.expenses.map((entry) => ({ kind: "expense" as const, entry })),
        ...file.earnings.map((entry) => ({ kind: "earning" as const, entry })),
        ...file.transfers.map((entry) => ({ kind: "transfer" as const, entry })),
      ];
      const changed = all
        .filter((e) => e.entry.amount > 0) // a $0 entry must be fixed before it can be saved
        // JSON text, not deep equality, so the key order has to match the importer's too.
        .filter((e) => JSON.stringify(checkDraft(draftFrom(e), setup, "unused")) !== JSON.stringify({ ok: true, entry: e }))
        .map((e) => e.entry.id);
      expect(changed).toEqual([]);
    });
  });

  describe("report functions", () => {
    it("money flow balances for the year and every month", () => {
      for (const month of [undefined, ...Array.from({ length: 12 }, (_, i) => i + 1)]) {
        const f = moneyFlow(ledger, month);
        const into = f.links.filter((l) => l.target === "hub").reduce((s, l) => s + l.value, 0);
        const out = f.links.filter((l) => l.source === "hub").reduce((s, l) => s + l.value, 0);
        expect(into, `month ${month}`).toBe(out);
      }
    });

    it("budget totals match net spending in every month", () => {
      const file = load();
      for (let m = 1; m <= 12; m++) {
        expect(budgetView(ledger, file.budgets, year, [m]).netSpent, `month ${m}`).toBe(summarize(ledger, m).netSpent);
      }
    });

    it("next year opens at this year's net worth: investments at 0 without their balances, assets with their value", () => {
      const next = nextYearSetup(load(), ledger);
      const openingNet = next.accounts.filter((a) => a.type !== "investment").reduce((s, a) => s + a.opening, 0);
      const end = accountsOverview(ledger, `${year}-12-31`);
      // Investment balance updates count in net worth, but a new year starts without them.
      expect(next.accounts.filter((a) => a.type === "investment").every((a) => a.valuations === undefined)).toBe(true);
      // An asset (opening 0) carries its value over as a January 1 update instead.
      const carried = next.accounts.flatMap((a) => (a.type === "asset" ? a.valuations ?? [] : []));
      expect(carried.every((v) => v.date === `${year + 1}-01-01`)).toBe(true);
      expect(carried.reduce((s, v) => s + v.amount, 0)).toBe(end.assetsWorth);
      expect(openingNet).toBe(end.netWorth - end.investmentsWorth - end.assetsWorth);
      expect(next.accounts.filter((a) => a.type === "investment").every((a) => a.opening === 0)).toBe(true);
    });

    it("saved this year ends at the year's net savings", () => {
      const [end] = balanceSeries(ledger, [`${year}-12-31`]);
      expect(end!.saved).toBe(summarize(ledger).netSavings);
    });

    it("weekly spending adds up to the year", () => {
      const total = weeklySpending(ledger, year).reduce((s, w) => s + w.bySource.bank + w.bySource.card + w.bySource.cash, 0);
      expect(total).toBe(summarize(ledger).spent);
    });
  });

  // The TypeScript port of tools/verify.py: recompute every Notion summary figure and compare.
  describe.skipIf(!existsSync(notionDir(year)))("matches Notion to the cent", () => {
    const dir = notionDir(year);
    // Compare like for like: undo the importer's reshaping of old-template rows first.
    const ledger: Ledger = asNotionSaw(load());
    const INDIA = "t_india";

    /** Notion column name -> the same figure from our Summary. Older templates have fewer columns. */
    const figures: [string, (s: Summary, month?: number) => number][] = [
      ["Amount Earned", (s) => s.earned],
      ["Earnings from Paychecks", (s) => s.paycheck],
      ["Earnings from Other Sources", (s) => s.otherEarned],
      ["Amount Spent", (s) => s.spent],
      ["Amount Spent from Bank", (s) => s.spentBySource.bank],
      ["Amount Spent in Card", (s) => s.spentBySource.card],
      ["Amount Spent in Cash", (s) => s.spentBySource.cash],
      ["CC Payments Made", (s) => s.ccPayments],
      ["Balance", (s) => s.surplus],
      ["Gross Savings", (s) => s.netSavings],
      ["Investment", (s) => s.investment],
      ["Investment in IRA", (s) => s.investRetirement],
      ["Investment in S&C", (s) => s.investTaxable],
      ["Charity Amount", (s) => s.charity],
      // Notion counted loan payments as spending in its Loan category; here they're transfers to a loan account.
      ["Loan Payment", (_, month) => spendByCategory(ledger, month).get("ce_loan")?.gross ?? 0],
      ["Send to India", (_, month) => tagTotal(ledger, INDIA, month)],
    ];

    const MONTHS = ["January", "February", "March", "April", "May", "June", "July",
      "August", "September", "October", "November", "December"];

    /** Collects mismatches, so one failing test lists all of them. */
    function checker() {
      const mismatches: string[] = [];
      let checked = 0;
      const check = (label: string, ours: number, theirs: number | null) => {
        if (theirs === null) return;
        checked++;
        if (ours !== theirs) mismatches.push(`${label}: ours ${ours / 100}, Notion ${theirs / 100}`);
      };
      return { check, mismatches, count: () => checked };
    }

    it("account closing balances", () => {
      const notion = new Map(readNotionTable(dir, "Accounts").map((r) => [r.Name, r]));
      const bal = balances(ledger);
      const { check, mismatches, count } = checker();
      // Accounts the importer added (2024's investment accounts) aren't in Notion.
      const known = ledger.accounts.filter((a) => notion.has(a.name));
      for (const a of known) check(a.name, bal.get(a.id)!, notionCents(notion.get(a.name)?.["Closing Balance"]));
      expect(mismatches).toEqual([]);
      expect(count()).toBe(known.length);
    });

    it("monthly summaries", () => {
      const { check, mismatches, count } = checker();
      for (const row of readNotionTable(dir, "Monthly")) {
        const month = MONTHS.indexOf(row.Name!.trim()) + 1;
        expect(month, row.Name).toBeGreaterThan(0);
        const s = summarize(ledger, month);
        for (const [col, get] of figures) check(`${row.Name} ${col}`, get(s, month), notionCents(row[col]));
      }
      expect(mismatches).toEqual([]);
      expect(count()).toBeGreaterThanOrEqual(12 * 4); // even the 2024 template has earned, spent, balance, CC payments
    });

    it("yearly summary", () => {
      const [row] = readNotionTable(dir, "Yearly");
      const headers = Object.keys(row!);
      // Yearly columns are rollups named like "<figure> RollUp" or "<figure> Amount Rollup".
      const rollup = (col: string) =>
        headers.find((h) => h.toLowerCase().startsWith(col.toLowerCase()) && h.toLowerCase().includes("rollup"));

      const s = summarize(ledger);
      const o = accountsOverview(ledger);
      const { check, mismatches, count } = checker();
      for (const [col, get] of figures) {
        const h = rollup(col);
        if (h) check(`YTD ${col}`, get(s), notionCents(row![h]));
      }
      check("Available cash", o.availableCash, notionCents(row!["Cash RollUp"]));
      check("Credit card debt", o.cardDebt, notionCents(row!["Credit Card Balance RollUp"]));
      check("Credit card limit", o.cardLimit, notionCents(row!["Credit Card Limit RollUp"]));
      expect(mismatches).toEqual([]);
      expect(count()).toBeGreaterThanOrEqual(4);
    });
  });
});

/** Pairs of consecutive years that both have data files. */
const PAIRS = YEARS.filter((y) => YEARS.includes(y + 1));

describe.skipIf(PAIRS.length === 0).each(PAIRS)("%i rolls into the next year", (year) => {
  it("every account kept by name opens at last year's closing balance (investments at 0)", () => {
    const prev: Ledger = loadJson(jsonPath(year));
    const next: YearFile = loadJson(jsonPath(year + 1));
    const closing = balances(prev);
    const byName = new Map(prev.accounts.map((a) => [a.name, a]));
    const diffs = next.accounts
      .filter((a) => byName.has(a.name))
      .map((a) => {
        const want = a.type === "investment" ? 0 : closing.get(byName.get(a.name)!.id)!;
        return a.opening === want ? null : `${a.name}: opens ${a.opening / 100}, closed ${want / 100}`;
      })
      .filter(Boolean);
    expect(diffs).toEqual([]);
  });
});
