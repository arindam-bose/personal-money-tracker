// When a year's tracking begins. Most years start on January 1; someone who starts using
// the tracker partway through a year picks the day they begin, and the ledger starts there.

import type { IsoDate, YearSetup } from "./types";

/** The first day of the year's ledger: its start date, or January 1. */
export function yearStart(setup: Pick<YearSetup, "year" | "start">): IsoDate {
  return setup.start ?? `${setup.year}-01-01`;
}

/** True when the year started after January 1. */
export function startsMidYear(setup: Pick<YearSetup, "start">): boolean {
  return setup.start !== undefined && !setup.start.endsWith("-01-01");
}

/** A day as "Jul 14", for labels like "Balance on Jul 14". Read as UTC, so it never slips a day. */
export function shortDay(iso: IsoDate): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
}
