// Runs only when your real, git-ignored data is present. Nothing here is committed with
// real numbers in it: every expected figure is read from Notion's own export at test time.

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { exportYear, importYear } from "../src/backup";
import {
  accountsOverview, balanceSeries, balances, budgetView, moneyFlow, summarize, tagTotal, weeklySpending, type Ledger, type Summary,
} from "../src/derive";
import { checkDraft, draftFrom, type AnyEntry } from "../src/entries";
import { nextYearSetup } from "../src/rollover";
import { validateYearFile } from "../src/validate";
import { freshDb, loadJson } from "./helpers";
import { notionCents, readNotionTable } from "./notion";

const PATH = "../data/money-tracker-2026.json";
const NOTION_DIR = fileURLToPath(new URL("../data/Notion", import.meta.url));
const present = existsSync(new URL(PATH, import.meta.url));

describe.skipIf(!present)("real 2026 data", () => {
  beforeEach(freshDb);

  it("is a valid year file", () => {
    const r = validateYearFile(loadJson(PATH));
    expect(r.ok ? [] : r.errors).toEqual([]);
  });

  it("round-trips through IndexedDB unchanged", async () => {
    const file = loadJson(PATH);
    await importYear(file);
    const out = (await exportYear(2026))!;
    expect(out.expenses).toHaveLength(510);
    expect(out.earnings).toHaveLength(97);
    expect(out.transfers).toHaveLength(264);
    expect({ ...out, exportedAt: "" }).toEqual({ ...file, exportedAt: "" });
  });

  it("every entry opens in the form and saves back unchanged", () => {
    const file = loadJson(PATH);
    const setup = { ...file, people: file.people ?? [] };
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

// The TypeScript port of tools/verify.py: recompute every Notion summary figure and compare.
describe.skipIf(!present || !existsSync(NOTION_DIR))("matches Notion to the cent", () => {
  const ledger: Ledger = loadJson(PATH);
  const INDIA = "t_india";

  /** Notion column name -> the same figure from our Summary. */
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
    ["Loan Payment", (s) => s.loan],
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
    const notion = new Map(readNotionTable(NOTION_DIR, "Accounts").map((r) => [r.Name, r]));
    const bal = balances(ledger);
    const { check, mismatches, count } = checker();
    for (const a of ledger.accounts) check(a.name, bal.get(a.id)!, notionCents(notion.get(a.name)?.["Closing Balance"]));
    expect(mismatches).toEqual([]);
    expect(count()).toBe(ledger.accounts.length);
  });

  it("monthly summaries", () => {
    const { check, mismatches, count } = checker();
    for (const row of readNotionTable(NOTION_DIR, "Monthly Summary")) {
      const month = MONTHS.indexOf(row.Name!.trim()) + 1;
      expect(month, row.Name).toBeGreaterThan(0);
      const s = summarize(ledger, month);
      for (const [col, get] of figures) check(`${row.Name} ${col}`, get(s, month), notionCents(row[col]));
    }
    expect(mismatches).toEqual([]);
    expect(count()).toBeGreaterThanOrEqual(12 * 15);
  });

  it("yearly summary", () => {
    const [row] = readNotionTable(NOTION_DIR, "Yearly Summary");
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
    expect(count()).toBeGreaterThanOrEqual(15);
  });
});

describe.skipIf(!present)("report functions on real data", () => {
  const ledger: Ledger = loadJson(PATH);

  it("money flow balances for the year and every month", () => {
    for (const month of [undefined, ...Array.from({ length: 12 }, (_, i) => i + 1)]) {
      const f = moneyFlow(ledger, month);
      const into = f.links.filter((l) => l.target === "hub").reduce((s, l) => s + l.value, 0);
      const out = f.links.filter((l) => l.source === "hub").reduce((s, l) => s + l.value, 0);
      expect(into, `month ${month}`).toBe(out);
    }
  });

  it("budget totals match net spending in every month", () => {
    const file = loadJson(PATH);
    for (let m = 1; m <= 12; m++) {
      expect(budgetView(ledger, file.budgets, 2026, [m]).netSpent, `month ${m}`).toBe(summarize(ledger, m).netSpent);
    }
  });

  it("next year opens at this year's net tangible assets, investments at 0", () => {
    const file = loadJson(PATH);
    const next = nextYearSetup(file, ledger);
    const openingNet = next.accounts.filter((a) => a.type !== "investment").reduce((s, a) => s + a.opening, 0);
    expect(openingNet).toBe(accountsOverview(ledger).netTangibleAssets);
    expect(next.accounts.filter((a) => a.type === "investment").every((a) => a.opening === 0)).toBe(true);
  });

  it("saved this year ends at the year's net savings", () => {
    const [end] = balanceSeries(ledger, ["2026-12-31"]);
    expect(end!.saved).toBe(summarize(ledger).netSavings);
  });

  it("weekly spending adds up to the year", () => {
    const total = weeklySpending(ledger, 2026).reduce((s, w) => s + w.bySource.bank + w.bySource.card + w.bySource.cash, 0);
    expect(total).toBe(summarize(ledger).spent);
  });
});
