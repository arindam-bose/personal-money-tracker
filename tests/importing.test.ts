// Importing from the top bar, Settings or a dropped file all go through importFile: the file is
// checked before anything is asked or stored, and a stored year is replaced only on a yes.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadYear } from "../src/db";
import { importFile, type AskReplace } from "../src/importing";
import { current, openYear, pins, saveIraLimit, years } from "../src/state";
import type { YearFile } from "../src/types";
import { freshDb, sample } from "./helpers";

// A change can arrive while an import is storing its year: `inGap` runs the moment it is stored.
const gap = vi.hoisted(() => ({ inGap: null as null | (() => void) }));
vi.mock("../src/backup", async (load) => {
  const backup = await load<typeof import("../src/backup")>();
  return {
    ...backup,
    importYear: async (data: unknown) => {
      const r = await backup.importYear(data);
      gap.inGap?.();
      return r;
    },
  };
});

const fileOf = (name: string, data: unknown) => new File([typeof data === "string" ? data : JSON.stringify(data)], name, { type: "application/json" });
/** The sample year with only its first `n` expenses: 8 + 6 + 5 = 19 entries in all. */
const withExpenses = (n: number): YearFile => ({ ...sample(), expenses: sample().expenses.slice(0, n) });
const never: AskReplace = async () => {
  throw new Error("asked when nothing was stored");
};

beforeEach(async () => {
  gap.inGap = null;
  await freshDb();
  await openYear();
});

describe("importFile", () => {
  it("imports a new year and opens it", async () => {
    const out = await importFile(fileOf("money-tracker-2026.json", sample()), never);
    expect(out).toEqual({ kind: "imported", fileName: "money-tracker-2026.json", year: 2026, entries: 19 });
    expect(current.value?.setup.year).toBe(2026);
    expect(years.value.map((y) => y.setup.year)).toEqual([2026]);
  });

  it("asks before replacing a stored year, with today's counts, and keeps it on no", async () => {
    await importFile(fileOf("old.json", withExpenses(3)), never);
    const ask = vi.fn<AskReplace>(async () => false);
    const out = await importFile(fileOf("new.json", sample()), ask);
    expect(ask).toHaveBeenCalledOnce();
    const [name, stored, file] = ask.mock.calls[0]!;
    expect(name).toBe("new.json");
    expect(stored.expenses).toBe(3);
    expect(file.expenses).toHaveLength(8);
    expect(out).toEqual({ kind: "kept", fileName: "new.json", year: 2026 });
    expect((await loadYear(2026))!.expenses).toHaveLength(3);
  });

  it("replaces a stored year on yes", async () => {
    await importFile(fileOf("old.json", withExpenses(3)), never);
    const out = await importFile(fileOf("new.json", sample()), async () => true);
    expect(out).toMatchObject({ kind: "imported", entries: 19 });
    expect((await loadYear(2026))!.expenses).toHaveLength(8);
  });

  it("stores nothing from a file that isn't JSON, or isn't a year, and never asks", async () => {
    const notJson = await importFile(fileOf("notes.txt", "not json"), never);
    expect(notJson).toEqual({ kind: "failed", fileName: "notes.txt", errors: ['"notes.txt" is not a valid JSON file.'] });
    const other = await importFile(fileOf("habits.json", { app: "habit-tracker" }), never);
    expect(other.kind).toBe("failed");
    expect(other.kind === "failed" && other.errors.length).toBeGreaterThan(0);
    expect(years.value).toEqual([]);
  });

  it("picks up the settings a backup brings, on a device without its own", async () => {
    const file: YearFile = { ...sample(), settings: { pinnedTags: ["t_grocery"] } };
    await importFile(fileOf("with-pins.json", file), never);
    expect(pins.pinnedTags.value).toEqual(["t_grocery"]);
  });
});

describe("a change made while a year is being imported", () => {
  it("waits for the imported year, and never writes the one it replaced back over it", async () => {
    // The tracker has 2026 with an extra tag; the backup has 2026 without it.
    const old: YearFile = { ...sample(), tags: [...sample().tags, { id: "t_old", name: "Old tag" }] };
    await importFile(fileOf("old.json", old), never);
    // An IRA limit is saved just as the backup's year is stored, before it is open.
    let saving: Promise<void> | undefined;
    gap.inGap = () => (saving = saveIraLimit(700000));
    await importFile(fileOf("new.json", sample()), async () => true);
    await saving;
    const stored = (await loadYear(2026))!;
    expect(stored.setup.tags.map((t) => t.id)).not.toContain("t_old");
    expect(current.value!.setup.tags.map((t) => t.id)).not.toContain("t_old");
    // The change still counts, on the imported year.
    expect(stored.setup.iraLimit).toBe(700000);
  });
});
