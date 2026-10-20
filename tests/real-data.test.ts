// Runs only when your real, git-ignored data file is present. It is never committed.
import { existsSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { exportYear, importYear } from "../src/backup";
import { validateYearFile } from "../src/validate";
import { freshDb, loadJson } from "./helpers";

const PATH = "../data/money-tracker-2026.json";
const present = existsSync(new URL(PATH, import.meta.url));

describe.skipIf(!present)("real 2026 data", () => {
  beforeEach(freshDb);

  it("is a valid year file", () => {
    const r = validateYearFile(loadJson(PATH));
    expect(r.ok ? [] : r.errors).toEqual([]);
  });

  it("round-trips through IndexedDB unchanged", async () => {
    const file = loadJson(PATH);
    await importYear(file);
    const out = (await exportYear(2026))!;
    expect(out.expenses).toHaveLength(510);
    expect(out.earnings).toHaveLength(97);
    expect(out.transfers).toHaveLength(264);
    expect({ ...out, exportedAt: "" }).toEqual({ ...file, exportedAt: "" });
  });
});
