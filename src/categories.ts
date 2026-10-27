// The Uncategorized category of each kind, on its own so that both setup.ts (deleting a
// category moves its entries here) and entries.ts (new entries start here) can use it.
// It imports only types: setup.ts already imports entries.ts, so keeping this in setup.ts
// would make the two depend on each other.

import type { Categories, Category, YearSetup } from "./types";

export type CategoryKind = "expense" | "earning" | "transfer";

/**
 * Where a deleted category's entries go, and where new entries start: one per kind, always
 * there, never deleted. Its roles keep its entries out of the headline figures: not paychecks,
 * not in net earnings, not savings or investing.
 */
export const UNCATEGORIZED: { [K in CategoryKind]: Categories[K][number] } = {
  expense: { id: "ce_uncategorized", name: "Uncategorized" },
  earning: { id: "ci_uncategorized", name: "Uncategorized", role: "income", net: false },
  transfer: { id: "ct_uncategorized", name: "Uncategorized", role: "general" },
};

/** The id of a kind's Uncategorized category: ours, or one the user already had by that name. */
export function uncategorizedId(setup: Pick<YearSetup, "categories">, kind: CategoryKind): string | undefined {
  const list = setup.categories[kind] as Category<string>[];
  const name = UNCATEGORIZED[kind].name.toLowerCase();
  return (list.find((c) => c.id === UNCATEGORIZED[kind].id) ?? list.find((c) => c.name.toLowerCase() === name))?.id;
}

/** The setup with an Uncategorized category in every kind. The same object if nothing was missing. */
export function withUncategorized(setup: YearSetup): YearSetup {
  const missing = (["expense", "earning", "transfer"] as CategoryKind[]).filter((k) => !uncategorizedId(setup, k));
  if (!missing.length) return setup;
  const categories = { ...setup.categories };
  for (const k of missing) (categories[k] as Category<string>[]) = [...categories[k], UNCATEGORIZED[k]];
  return { ...setup, categories };
}
