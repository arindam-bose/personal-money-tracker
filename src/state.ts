// App-wide reactive state. Components read these signals and re-render when they change.

import { signal } from "@preact/signals";
import { listYears, loadYear } from "./db";
import type { PersistState } from "./storage";
import type { YearSetup } from "./types";

export interface YearSummary {
  setup: YearSetup;
  expenses: number;
  earnings: number;
  transfers: number;
}

/** Every stored year with its entry counts, newest first. */
export const years = signal<YearSummary[]>([]);

export const persistState = signal<PersistState | null>(null);

export async function refreshYears(): Promise<void> {
  const setups = await listYears();
  const summaries = await Promise.all(
    setups.map(async (setup) => {
      const data = await loadYear(setup.year);
      return {
        setup,
        expenses: data?.expenses.length ?? 0,
        earnings: data?.earnings.length ?? 0,
        transfers: data?.transfers.length ?? 0,
      };
    }),
  );
  years.value = summaries.sort((a, b) => b.setup.year - a.setup.year);
}
