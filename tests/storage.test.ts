import { describe, expect, it } from "vitest";
import { lastUpdatedAt } from "../src/derive";
import { backupDue, backupText } from "../src/storage";

const now = new Date("2026-10-29T12:00:00Z");
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000).toISOString();

describe("backupText", () => {
  it("says how long ago, in words", () => {
    expect(backupText(undefined, now)).toBe("Never backed up");
    expect(backupText(daysAgo(0), now)).toBe("Backed up today");
    expect(backupText(daysAgo(1), now)).toBe("Last backup 1 day ago");
    expect(backupText(daysAgo(9), now)).toBe("Last backup 9 days ago");
  });
});

describe("backupDue", () => {
  it("reminds about a year that was never backed up", () => {
    expect(backupDue({ lastChangedAt: daysAgo(1) }, true, now)).toBe(true);
  });
  it("reminds a week after a backup, if the year changed since", () => {
    expect(backupDue({ lastBackupAt: daysAgo(9), lastChangedAt: daysAgo(2) }, true, now)).toBe(true);
    expect(backupDue({ lastBackupAt: daysAgo(6), lastChangedAt: daysAgo(2) }, true, now)).toBe(false);
  });
  it("counts setup changes (accounts, budgets) as well as entries", () => {
    expect(backupDue({ lastBackupAt: daysAgo(9), lastChangedAt: daysAgo(20), setupChangedAt: daysAgo(2) }, true, now)).toBe(true);
    expect(backupDue({ lastBackupAt: daysAgo(9), lastChangedAt: daysAgo(20), setupChangedAt: daysAgo(10) }, true, now)).toBe(false);
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

describe("lastUpdatedAt", () => {
  it("is the later of an entry change and a setup change", () => {
    expect(lastUpdatedAt({ lastChangedAt: daysAgo(3), setupChangedAt: daysAgo(1) })).toBe(daysAgo(1));
    expect(lastUpdatedAt({ lastChangedAt: daysAgo(1), setupChangedAt: daysAgo(3) })).toBe(daysAgo(1));
  });

  it("takes whichever there is, and nothing before the first change", () => {
    expect(lastUpdatedAt({ setupChangedAt: daysAgo(2) })).toBe(daysAgo(2));
    expect(lastUpdatedAt({ lastChangedAt: daysAgo(2) })).toBe(daysAgo(2));
    expect(lastUpdatedAt({})).toBeUndefined();
  });
});
