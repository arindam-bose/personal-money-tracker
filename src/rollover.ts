// Year rollover (brief §7): what the next year starts with when a year is closed.

import { balances, type Ledger } from "./derive";
import type { YearFile, YearSetup } from "./types";

/**
 * The next year's setup:
 * - bank, cash and card accounts open at this year's closing balance;
 * - investment accounts open at 0, because only this year's contributions are tracked
 *   (market value isn't, so gains and losses are unknown);
 * - accounts, categories, tags, members and the usual budget targets carry over.
 *   One-month budget overrides belong to their month, so they don't.
 */
export function nextYearSetup(setup: YearSetup, ledger: Ledger): YearSetup {
  const closing = balances(ledger);
  return {
    year: setup.year + 1,
    accounts: setup.accounts.map((a) => ({
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
    exportedAt: now.toISOString(),
    accounts: setup.accounts,
    categories: setup.categories,
    tags: setup.tags,
    ...(setup.members ? { members: setup.members } : {}),
    expenses: [],
    earnings: [],
    transfers: [],
    budgets: setup.budgets,
  };
}
