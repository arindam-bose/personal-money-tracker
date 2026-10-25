import { beforeEach, describe, expect, it } from "vitest";
import { exportYear, importYear, markBackedUp } from "../src/backup";
import { deleteEntry, deleteYear, getSetting, listYears, loadYear, putEntry, putSetup, setSetting } from "../src/db";
import { nextYearSetup } from "../src/rollover";
import { iraLimitOf } from "../src/setup";
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

  it("imports a file without a usable export time, as not backed up", async () => {
    expect(await importYear({ ...sample(), exportedAt: "not a date" })).toMatchObject({ ok: true });
    expect((await loadYear(2026))!.setup).not.toHaveProperty("lastBackupAt");
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
    expect(await getSetting("pinnedTags")).toBeUndefined();
    await setSetting("pinnedTags", ["t_india"]);
    expect(await getSetting("pinnedTags")).toEqual(["t_india"]);
  });
});

describe("a backup restores everything on a clean device", () => {
  it("keeps a closed year closed", async () => {
    await importYear(sample());
    await putSetup({ ...(await loadYear(2026))!.setup, closed: true });
    const backup = (await exportYear(2026))!;
    expect(backup.closed).toBe(true);

    await freshDb();
    await importYear(backup);
    expect((await loadYear(2026))!.setup.closed).toBe(true);
    expect(content((await exportYear(2026))!)).toEqual(content(backup));
  });

  it("leaves `closed` out of an open year's file", async () => {
    await importYear(sample());
    expect(await exportYear(2026)).not.toHaveProperty("closed");
  });

  it("keeps the year's own IRA limit", async () => {
    await importYear({ ...sample(), iraLimit: 800000 });
    const backup = (await exportYear(2026))!;
    expect(backup.iraLimit).toBe(800000);
    await freshDb();
    await importYear(backup);
    expect(iraLimitOf((await loadYear(2026))!.setup)).toBe(800000);
  });

  it("carries the pinned tags, without overwriting a device's own", async () => {
    await importYear(sample());
    await setSetting("pinnedTags", ["t_india"]);
    const backup = (await exportYear(2026))!;
    expect(backup.settings).toEqual({ pinnedTags: ["t_india"] });

    await freshDb();
    await importYear(backup);
    expect(await getSetting("pinnedTags")).toEqual(["t_india"]);

    await setSetting("pinnedTags", []);
    await importYear(backup);
    expect(await getSetting("pinnedTags")).toEqual([]);
  });
});

describe("IRA limit", () => {
  it("is the IRS limit for the year unless one is set", () => {
    expect(iraLimitOf({ year: 2024 })).toBe(700000);
    expect(iraLimitOf({ year: 2025 })).toBe(700000);
    expect(iraLimitOf({ year: 2026 })).toBe(750000);
    expect(iraLimitOf({ year: 2030 })).toBe(750000); // not listed yet: the latest one
    expect(iraLimitOf({ year: 2020 })).toBe(700000); // before the list: the earliest one
    expect(iraLimitOf({ year: 2026, iraLimit: 0 })).toBe(0);
  });

  it("is always in the backup, as the IRS limit when none is set", async () => {
    const { iraLimit: _gone, ...older } = { ...sample(), year: 2025 };
    older.expenses = older.expenses.map((e) => ({ ...e, date: "2025" + e.date.slice(4) }));
    older.earnings = older.earnings.map((e) => ({ ...e, date: "2025" + e.date.slice(4) }));
    older.transfers = older.transfers.map((e) => ({ ...e, date: "2025" + e.date.slice(4) }));
    older.budgets = { default: {} };
    await importYear(older);
    expect((await exportYear(2025))!.iraLimit).toBe(700000);
  });

  it("doesn't carry into the next year", async () => {
    await importYear({ ...sample(), iraLimit: 800000 });
    const data = (await loadYear(2026))!;
    const next = nextYearSetup(data.setup, { ...data, accounts: data.setup.accounts, categories: data.setup.categories });
    expect(next).not.toHaveProperty("iraLimit");
    expect(next).not.toHaveProperty("closed");
  });
});
