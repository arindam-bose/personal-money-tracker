// Hide the numbers: the amounts on the Dashboard, Reports, Budget, Accounts and Over the years
// pages, the totals above the Ledger and the balances when closing a year, show as dots, for when
// someone can see the screen. The choice is kept in this browser only, like the theme: it belongs
// to the device, not the data, so backups leave it out.

import { signal } from "@preact/signals";
import { formatCents, formatCompact } from "./money";
import type { Cents } from "./types";

/** Named for this app: other tools share the site's storage. */
const KEY = "money-tracker-hide-numbers";

/** The same length for every amount, so it doesn't give away how big one is. */
export const HIDDEN_AMOUNT = "$•••••";

function savedChoice(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export const numbersHidden = signal(savedChoice());

export function setNumbersHidden(hidden: boolean): void {
  numbersHidden.value = hidden;
  try {
    if (hidden) localStorage.setItem(KEY, "1");
    else localStorage.removeItem(KEY);
  } catch {
    // Not kept; the choice still applies until the page reloads.
  }
}

/** formatCents, or the dots while the numbers are hidden. */
export function maskedCents(amount: Cents): string {
  return numbersHidden.value ? HIDDEN_AMOUNT : formatCents(amount);
}

/** formatCompact, or the dots while the numbers are hidden. */
export function maskedCompact(amount: Cents): string {
  return numbersHidden.value ? HIDDEN_AMOUNT : formatCompact(amount);
}
