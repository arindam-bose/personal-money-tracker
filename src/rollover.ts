// Year rollover (brief §7): what the next year starts with when a year is closed.

import { balances, type Ledger } from "./derive";
import type { YearFile, YearSetup } from "./types";

/** Every account's balance at the end of December 31, loan interest included. */
export function closingBalances(setup: YearSetup, ledger: Ledger): Map<string, number> {
  return balances({ ...ledger, year: setup.year, start: setup.start }, `${setup.year}-12-31`);
}

/**
 * The next year's setup:
 * - bank, cash, card and loan accounts open at this year's closing balance;
 * - investment accounts open at 0, because only this year's contributions are tracked,
 *   and without balance updates: what they're worth is left out until it's next updated;
 * - accounts, categories, tags, members and the usual budget targets carry over.
 *   One-month budget overrides belong to their month, so they don't, and neither does the
 *   IRA limit: it changes by year, so the new year starts at the IRS limit.
 * - the new year starts on January 1, even if this one started partway through.
 */
export function nextYearSetup(setup: YearSetup, ledger: Ledger): YearSetup {
  const closing = closingBalances(setup, ledger);
  return {
    year: setup.year + 1,
    accounts: setup.accounts.map(({ valuations: _v, ...a }) => ({
      ...a,
      opening: a.type === "investment" ? 0 : closing.get(a.id) ?? a.opening,
    })),
    categories: setup.categories,
    tags: setup.tags,
    ...(setup.members ? { members: setup.members } : {}),
    budgets: { default: { ...setup.budgets.default } },
  };
}

/** A year file with a setup and no entries yet. */
export function emptyYearFile(setup: YearSetup, now = new Date()): YearFile {
  return {
    app: "money-tracker",
    schema: 1,
    year: setup.year,
    ...(setup.start ? { start: setup.start } : {}),
    exportedAt: now.toISOString(),
    accounts: setup.accounts,
    categories: setup.categories,
    tags: setup.tags,
    ...(setup.members ? { members: setup.members } : {}),
    expenses: [],
    earnings: [],
    transfers: [],
    budgets: setup.budgets,
    ...(setup.iraLimit !== undefined ? { iraLimit: setup.iraLimit } : {}),
    ...(setup.iraBeforeStart !== undefined ? { iraBeforeStart: setup.iraBeforeStart } : {}),
  };
}
