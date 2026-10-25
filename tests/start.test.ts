import { beforeEach, describe, expect, it } from "vitest";
import { exportYear, importYear } from "../src/backup";
import { loadYear } from "../src/db";
import { balances, budgetView, monthProgress, remainingRetirement, summarize } from "../src/derive";
import { checkDraft, emptyDraft } from "../src/entries";
import { nextYearSetup } from "../src/rollover";
import { SetupError, withStart } from "../src/setup";
import { current, openYear, saveIraBeforeStart, setStart, startYear } from "../src/state";
import type { YearFile } from "../src/types";
import { validateYearFile } from "../src/validate";
import { dayBefore, firstMonth, monthShare, yearStart } from "../src/year";
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

  it("drops IRA contributions noted as before the start when it goes back to January 1", () => {
    const data = { ...year(), setup: { ...fromFeb(), iraBeforeStart: 200000 } };
    expect(withStart(data, null)).not.toHaveProperty("iraBeforeStart");
    expect(withStart(data, "2026-01-15").iraBeforeStart).toBe(200000);
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

describe("budgets and charts from the start month", () => {
  const july14 = { year: 2026, start: "2026-07-14" };

  it("knows how much of each month is tracked", () => {
    expect(firstMonth(july14)).toBe(7);
    expect(monthShare(july14, 6)).toBe(0);
    expect(monthShare(july14, 7)).toBeCloseTo(18 / 31);
    expect(monthShare(july14, 8)).toBe(1);
    expect(monthShare({ year: 2026 }, 1)).toBe(1);
    expect(dayBefore("2026-07-14")).toBe("2026-07-13");
    expect(dayBefore("2026-01-01")).toBe("2025-12-31");
  });

  it("leaves out months before the start and scales the first one", () => {
    const l = { ...sample(), expenses: [], earnings: [], transfers: [] };
    const budgets = { default: { ce_food: 31000 } };
    const ytd = budgetView(l, budgets, 2026, [1, 2, 3, 4, 5, 6, 7, 8], "2026-07-14");
    // July 14-31 is 18 of 31 days: 18,000; August is whole: 31,000.
    expect(ytd.lines.find((x) => x.cat === "ce_food")!.target).toBe(18000 + 31000);
    expect(budgetView(l, budgets, 2026, [6], "2026-07-14").lines.find((x) => x.cat === "ce_food")!.target).toBeUndefined();
    // Without a start, every month counts in full.
    expect(budgetView(l, budgets, 2026, [7]).lines.find((x) => x.cat === "ce_food")!.target).toBe(31000);
  });

  it("takes a this-month-only target in the start month as given", () => {
    const l = { ...sample(), expenses: [], earnings: [], transfers: [] };
    const budgets = { default: { ce_food: 31000 }, "2026-07": { ce_food: 20000 } };
    expect(budgetView(l, budgets, 2026, [7], "2026-07-14").lines.find((x) => x.cat === "ce_food")!.target).toBe(20000);
  });

  it("measures the first month's pace from the start day", () => {
    // July 14 to 31 is 18 days; on the 22nd, 9 of them have begun.
    expect(monthProgress(2026, 7, "2026-07-22", "2026-07-14")).toBeCloseTo(9 / 18);
    expect(monthProgress(2026, 7, "2026-07-22")).toBeCloseTo(22 / 31);
    expect(monthProgress(2026, 8, "2026-08-10", "2026-07-14")).toBeCloseTo(10 / 31);
  });
});

describe("IRA contributions before the start", () => {
  it("count against the limit", () => {
    const l = fromFeb();
    const tracked = summarize(l).investRetirement;
    expect(remainingRetirement(l, 750000, 200000)).toBe(750000 - 200000 - tracked);
    expect(remainingRetirement(l, 750000)).toBe(750000 - tracked);
    expect(remainingRetirement(l, 750000, 900000)).toBe(0);
  });

  it("are saved with the year and kept by its backup, but not carried into the next year", async () => {
    await importYear(fromFeb());
    await openYear(2026);
    await saveIraBeforeStart(200000);
    const backup = (await exportYear(2026))!;
    expect(backup.iraBeforeStart).toBe(200000);
    await freshDb();
    await importYear(backup);
    const data = (await loadYear(2026))!;
    expect(data.setup.iraBeforeStart).toBe(200000);
    const next = nextYearSetup(data.setup, { ...data, accounts: data.setup.accounts, categories: data.setup.categories });
    expect(next).not.toHaveProperty("iraBeforeStart");
  });

  it("are cleared by saving nothing", async () => {
    await importYear({ ...fromFeb(), iraBeforeStart: 5000 });
    await openYear(2026);
    await saveIraBeforeStart(0);
    expect(current.value!.setup).not.toHaveProperty("iraBeforeStart");
  });

  it("must be whole cents in a file", () => {
    expect(validateYearFile({ ...fromFeb(), iraBeforeStart: -1 })).toEqual({ ok: false, errors: ['"iraBeforeStart" is not whole cents.'] });
  });
});
