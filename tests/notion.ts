// Reads the summary CSVs of a Notion "Money Tracker" export, for comparing our
// numbers with Notion's. Test-only; the export lives in the git-ignored data/ folder.

import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { Expense, YearFile } from "../src/types";

export type CsvRow = Record<string, string>;

/** Parse CSV text: quoted fields, "" escapes, commas and newlines inside quotes. */
export function parseCsv(text: string): CsvRow[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += ch;
  }
  if (field || row.length) { row.push(field); rows.push(row); }

  const [header, ...body] = rows;
  if (!header) return [];
  return body
    .filter((r) => r.some((f) => f !== ""))
    .map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])));
}

/**
 * Find "[Money Tracker ]<key> <year> <id>_all.csv" anywhere under the export folder.
 * The `_all` files hold every row; the others are filtered views. The word boundary
 * keeps "Accounts" from matching "Transfers Between Accounts".
 */
export function readNotionTable(exportDir: string, key: string): CsvRow[] {
  const rx = new RegExp(`^(Money Tracker )?${key}\\b.*_all\\.csv$`);
  const hits = (readdirSync(exportDir, { recursive: true }) as string[])
    .filter((p) => rx.test(basename(p)));
  if (hits.length !== 1) throw new Error(`expected one ${key} file, found ${hits.length}`);
  return parseCsv(readFileSync(join(exportDir, hits[0]!), "utf-8"));
}

/** Notion money ("-$1,234.56", or a raw float rollup like "87546.30000000002") to cents. */
export function notionCents(s: string | undefined): number | null {
  const t = (s ?? "").replace(/[$,]/g, "").trim();
  return t ? Math.round(Number(t) * 100) : null;
}

// Must match tools/notion_import.py: rows it reshaped carry these notes.
const REFUND_NOTE = "Imported from Notion, where it was a negative expense.";
const INVEST_NOTE = "Imported from Notion, where it was an Investment expense.";

/**
 * The data as Notion counted it, for comparing totals: rows the importer reshaped go back to
 * being expenses (a refund as a negative expense, an investment transfer as an expense).
 * Same as notion_view() in tools/verify.py.
 */
export function asNotionSaw(file: YearFile): YearFile {
  const expenses: Expense[] = [...file.expenses];
  const earnings = file.earnings.filter((r) => {
    if (!r.notes.includes(REFUND_NOTE)) return true;
    expenses.push({ id: r.id, date: r.date, item: r.item, amount: -r.amount, account: r.account, cat: r.offsets ?? "", tags: [], notes: r.notes });
    return false;
  });
  const transfers = file.transfers.filter((r) => {
    if (!r.notes.includes(INVEST_NOTE)) return true;
    expenses.push({ id: r.id, date: r.date, item: r.item, amount: r.amount, account: r.from, cat: "ce_investment", tags: [], notes: r.notes });
    return false;
  });
  return { ...file, expenses, earnings, transfers };
}
