import { beforeEach, describe, expect, it } from "vitest";
import { exportYear, importYear } from "../src/backup";
import { loadYear } from "../src/db";
import { balances } from "../src/derive";
import { checkDraft, emptyDraft } from "../src/entries";
import { nextYearSetup } from "../src/rollover";
import { SetupError, withStart } from "../src/setup";
import { current, openYear, setStart, startYear } from "../src/state";
import type { YearFile } from "../src/types";
import { validateYearFile } from "../src/validate";
import { yearStart } from "../src/year";
import { freshDb, sample } from "./helpers";

/** The sample, started on February 1: only its entries from then on, as someone starting that day would have. */
function fromFeb(): YearFile {
  const f = sample();
  const later = <T extends { date: string }>(list: T[]) => list.filter((e) => e.date >= "2026-02-01");
  return { ...f, start: "2026-02-01", expenses: later(f.expenses), earnings: later(f.earnings), transfers: later(f.transfers) };
}

beforeEach(freshDb);

describe("a year that starts partway through", () => {
  it("starts on January 1 unless it says otherwise", () => {
    expect(yearStart(sample())).toBe("2026-01-01");
    expect(yearStart(fromFeb())).toBe("2026-02-01");
  });

  it("imports, and rejects entries dated before its start", () => {
    expect(validateYearFile(fromFeb())).toMatchObject({ ok: true });
    const early = { ...fromFeb(), expenses: sample().expenses };
    const r = validateYearFile(early);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.errors[0]).toBe(
      'Expense "e0001" is dated 2026-01-01, before 2026\'s tracking starts (2026-02-01). The opening balances already include it.');
  });

  it("needs a real day of that year", () => {
    expect(validateYearFile({ ...fromFeb(), start: "2025-07-14" })).toEqual(
      { ok: false, errors: ['"start" must be a date in 2026, like "2026-07-14".'] });
    expect(validateYearFile({ ...fromFeb(), start: "2026-02-30" })).toMatchObject({ ok: false });
  });

  it("won't take a new entry dated before the start", () => {
    const setup = fromFeb();
    const before = checkDraft(emptyDraft("expense", "2026-01-31"), setup, "e_new");
    expect(!before.ok && before.errors.date).toBe("Tracking starts on Feb 1. Pick that day or later.");
    const onTheDay = checkDraft(emptyDraft("expense", "2026-02-01"), setup, "e_new");
    expect(!onTheDay.ok && onTheDay.errors.date).toBeUndefined();
  });

  it("keeps its start through a backup, and the next year starts on January 1", async () => {
    await importYear(fromFeb());
    const backup = (await exportYear(2026))!;
    expect(backup.start).toBe("2026-02-01");
    const data = (await loadYear(2026))!;
    const next = nextYearSetup(data.setup, { ...data, accounts: data.setup.accounts, categories: data.setup.categories });
    expect(next).not.toHaveProperty("start");
  });

  it("leaves `start` out of a year that begins on January 1", async () => {
    await importYear(sample());
    expect(await exportYear(2026)).not.toHaveProperty("start");
  });

  it("works out balances from the opening on the start date", () => {
    const f = fromFeb();
    const l = { ...f, accounts: f.accounts.map((a) => ({ ...a, opening: a.id === "a_checking" ? 100000 : 0 })) };
    const moved = [...l.earnings.filter((e) => e.account === "a_checking").map((e) => e.amount),
      ...l.expenses.filter((e) => e.account === "a_checking").map((e) => -e.amount),
      ...l.transfers.filter((t) => t.to === "a_checking").map((t) => t.amount),
      ...l.transfers.filter((t) => t.from === "a_checking").map((t) => -t.amount)].reduce((a, b) => a + b, 0);
    expect(balances(l).get("a_checking")).toBe(100000 + moved);
  });
});

describe("moving the start", () => {
  const year = () => ({ setup: fromFeb(), expenses: fromFeb().expenses, earnings: fromFeb().earnings, transfers: fromFeb().transfers });

  it("goes earlier freely, and back to January 1 by leaving it out", () => {
    expect(withStart(year(), "2026-01-15").start).toBe("2026-01-15");
    expect(withStart(year(), null)).not.toHaveProperty("start");
    expect(withStart(year(), "2026-01-01")).not.toHaveProperty("start");
  });

  it("can't go past an entry that already exists", () => {
    expect(() => withStart(year(), "2026-12-01")).toThrow(SetupError);
    expect(() => withStart(year(), "2026-12-01")).toThrow("There are entries from Feb 1, so tracking can't start later than that. Move or delete them first.");
    expect(() => withStart(year(), "2025-12-01")).toThrow("Pick a day in 2026.");
  });

  it("is saved for the open year", async () => {
    await importYear(fromFeb());
    await openYear(2026);
    await setStart("2026-01-15");
    expect((await loadYear(2026))!.setup.start).toBe("2026-01-15");
    await expect(setStart("2026-11-01")).rejects.toThrow(SetupError);
    expect(current.value!.setup.start).toBe("2026-01-15");
  });

  it("can be chosen when starting a year from scratch", async () => {
    await startYear(2026, "2026-07-14");
    expect(current.value!.setup.start).toBe("2026-07-14");
    await freshDb();
    await startYear(2026);
    expect(current.value!.setup).not.toHaveProperty("start");
  });
});
