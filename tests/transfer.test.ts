// A backup moves a year between devices: exported on one, imported on a clean one, it must
// come back exactly as it was. This uses every optional field a year file can hold, so a
// field added later and forgotten in export or import fails here.

import { beforeEach, describe, expect, it } from "vitest";
import { exportYear, importYear } from "../src/backup";
import { getSetting, loadYear } from "../src/db";
import { current, openYear } from "../src/state";
import type { YearFile } from "../src/types";
import { validateYearFile } from "../src/validate";
import { freshDb, sample } from "./helpers";

/**
 * The sample year with every optional field set: a household, a mid-year start, a closed year,
 * and so on. Typed Required, so a field added to YearFile later must be added here too.
 */
function everything(): Required<YearFile> {
  const f = sample();
  const later = <T extends { date: string }>(list: T[]) => list.filter((e) => e.date >= "2026-01-15");
  return {
    ...f,
    start: "2026-01-15",
    lastChangedAt: "2026-10-26T22:16:00.000Z",
    closed: true,
    accounts: [
      ...f.accounts.map((a, i) => (i === 0 ? { ...a, archived: true } : a.type === "investment"
        ? { ...a, valuations: [{ date: "2026-03-01", amount: 120000 }, { date: "2026-06-30", amount: 131250 }] } : a)),
      { id: "a_car-loan", name: "Car loan", type: "loan", ref: "", opening: 0, loanStart: "2026-02-01", loanAmount: 2000000, rate: 6.5 },
      { id: "a_house", name: "House", type: "asset", ref: "", opening: 0, valuations: [{ date: "2026-01-15", amount: 45000000 }], closedOn: "2026-06-01" },
    ],
    categories: { ...f.categories, earning: f.categories.earning.map((c, i) => (i === 1 ? { ...c, net: false } : c)) },
    members: [{ id: "m_person-a", name: "Sam" }, { id: "m_alex", name: "Alex" }],
    expenses: later(f.expenses).map((e, i) => (i === 0 ? { ...e, member: "m_alex" } : e)),
    earnings: later(f.earnings).map((e, i) => (i === 0 ? { ...e, member: "m_alex" } : e)),
    transfers: later(f.transfers).map((e, i) => (i === 0 ? { ...e, member: "m_alex" } : e)),
    iraLimit: 800000,
    iraBeforeStart: 150000,
    settings: { pinnedTags: [f.tags[0]!.id] },
  };
}

/** The file as text, without the export time (it changes on every export). */
const asText = (f: YearFile) => JSON.stringify({ ...f, exportedAt: "" }, null, 1);

beforeEach(freshDb);

describe("moving a year to another device", () => {
  it("uses every optional field, and is a valid file", () => {
    const f = everything();
    expect(validateYearFile(f)).toMatchObject({ ok: true });
  });

  it("comes back exactly as it left: every field, and byte for byte the same file", async () => {
    // Device A: the year is there, and its backup is taken.
    await importYear(everything());
    const backup = (await exportYear(2026))!;
    expect({ ...backup, exportedAt: "" }).toEqual({ ...everything(), exportedAt: "" });

    // Device B: clean. Import the backup, then back it up again.
    await freshDb();
    expect(await importYear(JSON.parse(JSON.stringify(backup)))).toMatchObject({ ok: true });
    expect(asText((await exportYear(2026))!)).toBe(asText(backup));
  });

  it("opens on the new device as it was: closed, started mid-year, the household and the settings", async () => {
    await importYear(everything());
    const backup = (await exportYear(2026))!;
    await freshDb();
    await importYear(backup);
    await openYear(2026);
    const { setup } = current.value!;
    expect(setup.closed).toBe(true);
    expect(setup.start).toBe("2026-01-15");
    expect(setup.iraLimit).toBe(800000);
    expect(setup.iraBeforeStart).toBe(150000);
    expect(setup.members!.map((m) => m.name)).toEqual(["Sam", "Alex"]);
    expect(await getSetting("pinnedTags")).toEqual(everything().settings!.pinnedTags);
    // The import counts as a backup, made when the file was exported.
    expect((await loadYear(2026))!.setup.lastBackupAt).toBe(backup.exportedAt);
  });
});
