// Each Dashboard figure's colour, in one place: its tile's left stripe (.tile-<concept> in
// style.css) and its Over the years chart both read it, so the two can't drift apart. The
// colours are Reports' own: income blue, spending orange, savings green, investing amber, loans plum.

import type { Summary } from "../derive";

export type Concept = "income" | "spending" | "savings" | "investing" | "loans" | "transfers" | "gain" | "loss";

/** The CSS colour token for each concept. Charts read it with token(); style.css draws the stripe with it. */
export const CONCEPT_TOKEN: Record<Concept, string> = {
  income: "--series-1",
  spending: "--series-2",
  savings: "--series-3",
  investing: "--series-4",
  loans: "--series-6",
  transfers: "--transfer",
  gain: "--earning",
  loss: "--expense",
};

/** The Dashboard's figures, by their Summary key. Surplus goes by its sign: see surplusConcept. */
export const FIGURE_CONCEPT = {
  earned: "income",
  netEarnings: "income",
  spent: "spending",
  netSpent: "spending",
  netSavings: "savings",
  investment: "investing",
  ccPayments: "transfers",
  charity: "spending",
  loanPayments: "loans",
} as const satisfies Partial<Record<keyof Summary, Concept>>;

/** Surplus is green when it's a gain (or nothing), red when spending beat earnings. */
export function surplusConcept(surplus: number): Concept {
  return surplus < 0 ? "loss" : "gain";
}

/** Pinned categories and tags total spending, so they take its colour. */
export const PINNED_CONCEPT: Concept = "spending";
