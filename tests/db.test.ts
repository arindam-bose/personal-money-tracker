import { beforeEach, describe, expect, it } from "vitest";
import { exportYear, importYear, markBackedUp } from "../src/backup";
import { deleteEntry, deleteYear, getSetting, listYears, loadYear, putEntry, setSetting } from "../src/db";
import type { YearFile } from "../src/types";
import { freshDb, sample } from "./helpers";

beforeEach(freshDb);

/** A file without its export timestamp, which changes on every export. */
const content = ({ exportedAt: _, ...rest }: YearFile) => rest;

describe("import and export", () => {
  it("round-trips a year exactly", async () => {
    const file = sample();
    expect(await importYear(file)).toMatchObject({ ok: true });
    const out = await exportYear(2026);
    expect(out).not.toBeNull();
    expect(content(out!)).toEqual(content(file));
  });

  it("writes nothing when the file is invalid", async () => {
    const file = sample();
    file.expenses[0]!.account = "a_gone";
    expect(await importYear(file)).toMatchObject({ ok: false });
    expect(await listYears()).toEqual([]);
  });

  it("replaces a year completely on re-import", async () => {
    await importYear(sample());
    const smaller = sample();
    smaller.expenses = smaller.expenses.slice(0, 2);
    await importYear(smaller);
    expect((await loadYear(2026))!.expenses.map((e) => e.id)).toEqual(["e0001", "e0002"]);
  });

  it("keeps years separate even when ids repeat", async () => {
    await importYear(sample());
    const next = sample();
    next.year = 2027;
    next.expenses = next.expenses.map((e) => ({ ...e, date: "2027" + e.date.slice(4) }));
    next.earnings = next.earnings.map((e) => ({ ...e, date: "2027" + e.date.slice(4) }));
    next.transfers = next.transfers.map((e) => ({ ...e, date: "2027" + e.date.slice(4) }));
    next.budgets = { default: {} };
    await importYear(next);

    expect((await listYears()).map((y) => y.year)).toEqual([2026, 2027]);
    await deleteYear(2027);
    expect(content((await exportYear(2026))!)).toEqual(content(sample()));
    expect(await loadYear(2027)).toBeNull();
  });

  it("tracks the last backup time", async () => {
    await importYear(sample());
    expect((await loadYear(2026))!.setup.lastBackupAt).toBe("2026-03-01T12:00:00.000Z");
    await markBackedUp(2026, new Date("2026-04-01T00:00:00Z"));
    expect((await loadYear(2026))!.setup.lastBackupAt).toBe("2026-04-01T00:00:00.000Z");
  });
});

describe("single entries", () => {
  it("adds, edits and deletes an entry, keeping date order", async () => {
    await importYear(sample());
    await putEntry("expenses", 2026, {
      id: "e_new", date: "2026-01-02", item: "Snack", amount: 300,
      account: "a_wallet", cat: "ce_food", tags: [], notes: "",
    });
    let ids = (await loadYear(2026))!.expenses.map((e) => e.id);
    expect(ids.slice(0, 3)).toEqual(["e0001", "e_new", "e0002"]);

    await putEntry("expenses", 2026, { ...sample().expenses[0]!, amount: 1 });
    expect((await loadYear(2026))!.expenses[0]!.amount).toBe(1);

    await deleteEntry("expenses", 2026, "e_new");
    ids = (await loadYear(2026))!.expenses.map((e) => e.id);
    expect(ids).not.toContain("e_new");
  });
});

describe("settings", () => {
  it("stores and reads values", async () => {
    expect(await getSetting("iraLimit")).toBeUndefined();
    await setSetting("iraLimit", 750000);
    expect(await getSetting("iraLimit")).toBe(750000);
  });
});
