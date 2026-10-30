import { describe, expect, it } from "vitest";
import { backupDue } from "../src/storage";

const now = new Date("2026-10-29T12:00:00Z");
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000).toISOString();

describe("backupDue", () => {
  it("reminds about a year that was never backed up", () => {
    expect(backupDue({ lastChangedAt: daysAgo(1) }, true, now)).toBe(true);
  });
  it("reminds a week after a backup, if the year changed since", () => {
    expect(backupDue({ lastBackupAt: daysAgo(9), lastChangedAt: daysAgo(2) }, true, now)).toBe(true);
    expect(backupDue({ lastBackupAt: daysAgo(6), lastChangedAt: daysAgo(2) }, true, now)).toBe(false);
  });
  it("stays quiet for a year untouched since its backup, however old", () => {
    expect(backupDue({ lastBackupAt: daysAgo(90), lastChangedAt: daysAgo(100) }, true, now)).toBe(false);
  });
  it("counts a year without a change time as changed", () => {
    expect(backupDue({ lastBackupAt: daysAgo(9) }, true, now)).toBe(true);
  });
  it("never reminds about a closed year or one with no entries", () => {
    expect(backupDue({ closed: true, lastChangedAt: daysAgo(1) }, true, now)).toBe(false);
    expect(backupDue({}, false, now)).toBe(false);
  });
});
