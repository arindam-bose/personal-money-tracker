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

/** The month (1 to 12) tracking starts in. */
export function firstMonth(setup: Pick<YearSetup, "year" | "start">): number {
  return Number(yearStart(setup).slice(5, 7));
}

/** The day before tracking starts: where balances stand at the opening, e.g. "2025-12-31". */
export function dayBefore(iso: IsoDate): IsoDate {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * How much of a month the ledger covers: 0 before the start month, 1 after it, and in
 * the start month the share of its days from the start on (18 of 31 from July 14).
 */
export function monthShare(setup: Pick<YearSetup, "year" | "start">, month: number): number {
  const first = firstMonth(setup);
  if (month !== first) return month < first ? 0 : 1;
  const days = new Date(Date.UTC(setup.year, month, 0)).getUTCDate();
  return (days - Number(yearStart(setup).slice(8, 10)) + 1) / days;
}
