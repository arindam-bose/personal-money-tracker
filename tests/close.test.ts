// Closing an account on a day: sold, paid off or shut. From then it's left out of net tangible
// assets; nothing can be entered for it after, and the next year doesn't have it.

import { describe, expect, it } from "vitest";
import { accountsOverview, type Ledger } from "../src/derive";
import { checkDraft, emptyDraft } from "../src/entries";
import { emptyYearFile, nextYearSetup } from "../src/rollover";
import { blankSetup, closeAccount, reopenAccount, saveAccount, saveValuation, withStart } from "../src/setup";
import type { Account, Transfer, YearSetup } from "../src/types";
import { validateYearFile } from "../src/validate";

const checking: Account = { id: "a_checking", name: "Checking", type: "checking", ref: "", opening: 1000000 };
const old: Account = { id: "a_old", name: "Old Savings", type: "savings", ref: "", opening: 50000 };
const card: Account = { id: "a_card", name: "Card", type: "credit", ref: "", opening: 0, limit: 500000 };
const car: Account = { id: "a_car", name: "Car", type: "asset", ref: "", opening: 0 };
const move = (id: string, date: string, amount: number, from: string, to: string): Transfer =>
  ({ id, date, item: "Move", amount, from, to, cat: "ct_general-transfer", notes: "" });

function year(transfers: Transfer[] = []) {
  let setup: YearSetup = { ...blankSetup(2026), accounts: [checking, old, card, car] };
  setup = saveValuation(setup, "a_car", "2026-01-01", 2000000);
  return { setup, expenses: [], earnings: [], transfers };
}
const ledgerOf = (d: ReturnType<typeof year>): Ledger =>
  ({ ...d, year: 2026, accounts: d.setup.accounts, categories: d.setup.categories });
const find = (s: YearSetup, id: string) => s.accounts.find((a) => a.id === id)!;

describe("closing an asset", () => {
  it("leaves it out of net tangible assets from that day; before it, it still counts", () => {
    const d = year();
    const closed = { ...d, setup: closeAccount(d, "a_car", "2026-02-14") };
    const l = ledgerOf(closed);
    expect(accountsOverview(l, "2026-02-13")).toMatchObject({ assetsWorth: 2000000, netTangibleAssets: 1050000 + 2000000 });
    expect(accountsOverview(l, "2026-02-14")).toMatchObject({ assetsWorth: 0, netTangibleAssets: 1050000 });
    expect(accountsOverview(l).closed).toEqual(new Set(["a_car"]));
  });

  it("isn't carried into the next year", () => {
    const d = year();
    const s = closeAccount(d, "a_car", "2026-02-14");
    expect(nextYearSetup(s, ledgerOf({ ...d, setup: s })).accounts.map((a) => a.id)).toEqual(["a_checking", "a_old", "a_card"]);
  });

  it("can't take a value update from that day on, nor be closed before its last one", () => {
    const d = year();
    const s = closeAccount(d, "a_car", "2026-02-14");
    expect(() => saveValuation(s, "a_car", "2026-02-14", 100)).toThrow("was closed on Feb 14");
    const later = { ...d, setup: saveValuation(d.setup, "a_car", "2026-03-01", 1900000) };
    expect(() => closeAccount(later, "a_car", "2026-02-14")).toThrow("value update on or after Feb 14");
  });

  it("can be reopened, and keeps being closed through an edit", () => {
    const d = year();
    const s = closeAccount(d, "a_car", "2026-02-14");
    expect(find(saveAccount(s, { ...find(s, "a_car"), name: "Honda" }), "a_car").closedOn).toBe("2026-02-14");
    expect(find(reopenAccount(s, "a_car"), "a_car").closedOn).toBeUndefined();
  });
});

describe("closing an account that holds money", () => {
  it("needs it at 0 that day, so the money isn't lost", () => {
    expect(() => closeAccount(year(), "a_old", "2026-03-01")).toThrow("still has $500.00 on Mar 1");
    const emptied = year([move("x1", "2026-02-28", 50000, "a_old", "a_checking")]);
    expect(find(closeAccount(emptied, "a_old", "2026-03-01"), "a_old").closedOn).toBe("2026-03-01");
  });

  it("can't close before its last entry, and takes no entries after", () => {
    const d = year([move("x1", "2026-02-28", 50000, "a_old", "a_checking")]);
    expect(() => closeAccount(d, "a_old", "2026-02-01")).toThrow("entries after Feb 1 (the first on Feb 28)");
    const s = closeAccount(d, "a_old", "2026-03-01");
    const after = { ...emptyDraft("transfer", "2026-03-02"), item: "x", amount: "1", from: "a_checking", to: "a_old", cat: "ct_general-transfer" };
    expect(checkDraft(after, s, "x2")).toMatchObject({ ok: false, errors: { to: "Old Savings was closed on Mar 1." } });
    expect(checkDraft({ ...after, date: "2026-03-01" }, s, "x2").ok).toBe(true);
  });

  it("takes a closed card's limit out of utilization", () => {
    const d = year();
    const l = ledgerOf({ ...d, setup: closeAccount(d, "a_card", "2026-04-01") });
    expect(accountsOverview(l, "2026-03-31")).toMatchObject({ cardLimit: 500000 });
    expect(accountsOverview(l, "2026-04-01")).toMatchObject({ cardLimit: 0, cards: [] });
  });

  it("keeps tracking from starting after it", () => {
    const d = year();
    const s = closeAccount(d, "a_car", "2026-02-14");
    expect(() => withStart({ ...d, setup: s }, "2026-03-01")).toThrow("was closed on Feb 14");
  });
});

describe("importing a closed account", () => {
  it("accepts one, and reports entries after it closed or a bad day", () => {
    const f = emptyYearFile({ ...blankSetup(2026), accounts: [checking, { ...old, closedOn: "2026-03-01" }] });
    expect(validateYearFile(f).ok).toBe(true);
    f.transfers = [move("x1", "2026-03-05", 100, "a_checking", "a_old")];
    const r = validateYearFile(f);
    expect(r.ok === false && r.errors).toEqual([`Transfer "x1" on 2026-03-05 uses "a_old", which was closed on 2026-03-01.`]);
    const bad = validateYearFile(emptyYearFile({ ...blankSetup(2026), accounts: [{ ...old, closedOn: "2025-12-01" }] }));
    expect(bad.ok === false && bad.errors[0]).toMatch(/closedOn must be a date in 2026/);
  });
});
