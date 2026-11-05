import { beforeEach, describe, expect, it, vi } from "vitest";
import { exportYear, importYear } from "../src/backup";
import { getSetting, listYears, loadYear, putEntryChange, setSetting } from "../src/db";
import { backUpYear, closeYear, current, ensureTag, eraseEverything, loadAllYears, openYear, pins, refreshYears, removeEntry, removeYear, removeTag, saveEntry, setBudget, years } from "../src/state";
import { demoYear } from "../src/demo";
import { freshDb, sample } from "./helpers";

beforeEach(async () => {
  await freshDb();
  await importYear(sample());
  await openYear(2026);
});

describe("backing up", () => {
  beforeEach(() => {
    // Only the browser's download itself is stood in for.
    vi.stubGlobal("document", { createElement: () => ({ click() {} }) });
    URL.createObjectURL = () => "blob:backup";
    URL.revokeObjectURL = () => {};
  });

  it("doesn't undo a save that's on its way", async () => {
    await Promise.all([setBudget("default", "ce_food", 1), backUpYear(2026), setBudget("default", "ce_rent", 2)]);
    const stored = (await loadYear(2026))!.setup;
    expect(stored.budgets.default).toMatchObject({ ce_food: 1, ce_rent: 2 });
    expect(current.value!.setup.budgets.default).toMatchObject({ ce_food: 1, ce_rent: 2 });
    expect(current.value!.setup.lastBackupAt).toBe(stored.lastBackupAt);
  });

  it("keeps the backup time when the year closes straight after", async () => {
    await backUpYear(2026);
    const at = (await loadYear(2026))!.setup.lastBackupAt;
    expect(at).not.toBe("2026-03-01T12:00:00.000Z");
    await closeYear();
    expect((await loadYear(2026))!.setup.lastBackupAt).toBe(at);
  });
});

describe("state changes", () => {
  it("keeps every change when several start at once", async () => {
    // Like typing targets down a column: each save starts before the last one finished.
    await Promise.all([
      setBudget("default", "ce_food", 1),
      setBudget("default", "ce_rent", 2),
      setBudget("default", "ce_charity", 3),
      setBudget("default", "ce_loan", 4),
      ensureTag("New tag"),
    ]);
    const want = { ce_food: 1, ce_rent: 2, ce_charity: 3, ce_loan: 4 };
    expect(current.value!.setup.budgets.default).toEqual(want);
    const stored = (await loadYear(2026))!.setup;
    expect(stored.budgets.default).toEqual(want);
    expect(stored.tags.map((t) => t.name)).toContain("New tag");
  });

  it("clears a month override and drops the empty month", async () => {
    await setBudget("2026-02", "ce_food", null);
    expect(current.value!.setup.budgets["2026-02"]).toBeUndefined();
  });

  it("carries on after a failed change", async () => {
    current.value = { ...current.value!, setup: { ...current.value!.setup, closed: true } };
    await expect(setBudget("default", "ce_food", 5)).rejects.toThrow("closed");
    current.value = { ...current.value!, setup: { ...current.value!.setup, closed: false } };
    await setBudget("default", "ce_food", 6);
    expect(current.value!.setup.budgets.default.ce_food).toBe(6);
  });
});

describe("last updated", () => {
  const stamp = async () => (await loadYear(2026))!.setup.lastChangedAt;

  it("is unknown for a file without one, then backed up and restored with the year", async () => {
    expect(await stamp()).toBeUndefined();
    expect(await exportYear(2026)).not.toHaveProperty("lastChangedAt");
    await saveEntry({ kind: "expense", entry: current.value!.expenses[0]! });
    const saved = await stamp();
    const backup = (await exportYear(2026))!;
    expect(backup.lastChangedAt).toBe(saved);
    await freshDb();
    await importYear(JSON.parse(JSON.stringify(backup)));
    expect(await stamp()).toBe(saved);
  });

  it("is stamped by saving and deleting entries, in storage and on screen", async () => {
    const before = Date.now();
    await saveEntry({ kind: "expense", entry: { ...current.value!.expenses[0]!, item: "Changed" } });
    const saved = await stamp();
    expect(Date.parse(saved!)).toBeGreaterThanOrEqual(before);
    expect(current.value!.setup.lastChangedAt).toBe(saved);
    await new Promise((r) => setTimeout(r, 5));
    await removeEntry("expense", current.value!.expenses[0]!.id);
    expect(Date.parse((await stamp())!)).toBeGreaterThan(Date.parse(saved!));
  });

  it("moves an entry to another kind in one go: gone from the old list, in the new one, stamped", async () => {
    const e = current.value!.expenses[0]!;
    const asEarning = { id: e.id, date: e.date, item: e.item, amount: e.amount, notes: e.notes, cat: current.value!.setup.categories.earning[0]!.id, account: e.account };
    await saveEntry({ kind: "earning", entry: asEarning }, "expense");
    const stored = (await loadYear(2026))!;
    expect(stored.expenses.some((x) => x.id === e.id)).toBe(false);
    expect(stored.earnings.find((x) => x.id === e.id)).toMatchObject({ item: e.item, amount: e.amount });
    expect(stored.setup.lastChangedAt).toBeDefined();
  });

  it("isn't stamped by setup changes that leave entries alone, but is when they move entries", async () => {
    await setBudget("default", "ce_food", 1);
    expect(await stamp()).toBeUndefined();
    const used = current.value!.expenses.find((e) => e.tags.length)!.tags[0]!;
    await removeTag(used);
    expect(await stamp()).toBeDefined();
  });

  it("keeps setup changes apart: they stamp setupChangedAt, entries don't", async () => {
    const setupStamp = async () => (await loadYear(2026))!.setup.setupChangedAt;
    expect(await setupStamp()).toBeUndefined();
    await saveEntry({ kind: "expense", entry: current.value!.expenses[0]! });
    expect(await setupStamp()).toBeUndefined();
    const before = Date.now();
    await setBudget("default", "ce_food", 1);
    const at = await setupStamp();
    expect(Date.parse(at!)).toBeGreaterThanOrEqual(before);
    expect(current.value!.setup.setupChangedAt).toBe(at);
    expect((await exportYear(2026))!.setupChangedAt).toBe(at);
    await removeTag(current.value!.setup.tags[0]!.id); // a change that also moves entries
    expect(Date.parse((await setupStamp())!)).toBeGreaterThanOrEqual(Date.parse(at!));
  });

  it("doesn't stamp a save that changes nothing", async () => {
    await setBudget("default", "ce_food", 1);
    const at = (await loadYear(2026))!.setup.setupChangedAt;
    await new Promise((r) => setTimeout(r, 5));
    await setBudget("default", "ce_food", 1); // the same target again
    expect((await loadYear(2026))!.setup.setupChangedAt).toBe(at);
  });
});

describe("years saved before people were dropped", () => {
  /** Store 2026 the way an older version did: a person, an owed share, a "Paid back" role. */
  async function storeOldShape(closed: boolean) {
    const { setup, expenses } = (await loadYear(2026))!;
    const earning = setup.categories.earning.map((c) => (c.id === "ci_payback" ? { ...c, role: "reimbursement" } : c));
    await putEntryChange({ ...setup, closed, categories: { ...setup.categories, earning }, people: [{ id: "p_sam", name: "Sam" }] } as never,
      { put: { kind: "expenses", entry: { ...expenses[2]!, owed: { person: "p_sam", amount: 3000 } } as never } });
  }

  it("cleans an open year and saves it that way", async () => {
    await storeOldShape(false);
    const before = (await loadYear(2026))!.setup;
    await openYear(2026);
    const stored = (await loadYear(2026))!;
    // Bringing it up to date isn't the user's change: neither stamp moves, so no backup reminder.
    expect(stored.setup.lastChangedAt).toBe(before.lastChangedAt);
    expect(stored.setup.setupChangedAt).toBe(before.setupChangedAt);
    expect(stored.setup).not.toHaveProperty("people");
    expect(stored.setup.categories.earning.find((c) => c.id === "ci_payback")!.role).toBe("offset");
    expect(stored.expenses[2]).not.toHaveProperty("owed");
  });

  it("shows and backs up a closed year cleaned, without rewriting it", async () => {
    await storeOldShape(true);
    await openYear(2026);
    expect(current.value!.setup).not.toHaveProperty("people");
    expect(current.value!.setup.categories.earning.find((c) => c.id === "ci_payback")!.role).toBe("offset");
    expect(current.value!.expenses[2]).not.toHaveProperty("owed");
    expect((await loadYear(2026))!.setup).toHaveProperty("people"); // storage untouched

    const backup = (await exportYear(2026))!;
    expect(backup).not.toHaveProperty("people");
    expect(backup.expenses[2]).not.toHaveProperty("owed");
    expect(backup.categories.earning.find((c) => c.id === "ci_payback")!.role).toBe("offset");
  });

  it("are cleaned the same way for Over the years, oldest first, without rewriting them", async () => {
    await storeOldShape(false);
    expect(await importYear(demoYear(2025))).toMatchObject({ ok: true });
    await refreshYears();
    const all = await loadAllYears();
    expect(all.map((d) => d.setup.year)).toEqual([2025, 2026]);
    expect(all[1]!.setup).not.toHaveProperty("people");
    expect(all[1]!.setup.categories.earning.find((c) => c.id === "ci_payback")!.role).toBe("offset");
    expect((await loadYear(2026))!.setup).toHaveProperty("people"); // storage untouched until the year is opened
  });
});

describe("erase everything", () => {
  it("leaves nothing stored, so the app starts empty", async () => {
    const next = { ...sample(), year: 2027, expenses: [], earnings: [], transfers: [], budgets: { default: {} } };
    await importYear(next);
    await setSetting("pinnedTags", ["t_x"]);
    pins.pinnedTags.value = ["t_x"];

    await eraseEverything();
    expect(await listYears()).toEqual([]);
    expect(await loadYear(2026)).toBeNull();
    expect(await getSetting("pinnedTags")).toBeUndefined();
    expect(await getSetting("activeYear")).toBeUndefined();
    expect(current.value).toBeNull();
    expect(years.value).toEqual([]);
    expect(pins.pinnedTags.value).toEqual([]);

    // And a backup restores it all again.
    await importYear(sample());
    await openYear();
    expect(current.value!.expenses).toHaveLength(sample().expenses.length);
  });
});

describe("delete a year", () => {
  /** 2025 beside the sample's 2026: same setup, no entries. */
  const year2025 = () => ({ ...sample(), year: 2025, expenses: [], earnings: [], transfers: [], budgets: { default: {} } });

  it("removes only that year, and keeps the open one open", async () => {
    await importYear(year2025());
    await openYear(2026);
    await removeYear(2025);
    expect((await listYears()).map((y) => y.year)).toEqual([2026]);
    expect(current.value!.setup.year).toBe(2026);
    expect(current.value!.expenses).toHaveLength(sample().expenses.length);
    expect(years.value.map((y) => y.setup.year)).toEqual([2026]);
  });

  it("opens another year when the open one is deleted", async () => {
    await importYear(year2025());
    await openYear(2026);
    await removeYear(2026);
    expect(await loadYear(2026)).toBeNull();
    expect(current.value!.setup.year).toBe(2025);
  });

  it("leaves nothing open when the last year goes, and its backup brings it back", async () => {
    const backup = (await exportYear(2026))!;
    await removeYear(2026);
    expect(current.value).toBeNull();
    expect(years.value).toEqual([]);
    await importYear(backup);
    await openYear(2026);
    expect(current.value!.expenses).toHaveLength(sample().expenses.length);
  });
});
