import { describe, expect, it } from "vitest";
import {
  checkDraft, draftFrom, duplicateEntry, emptyDraft, newId, slug, suggestTransferCategory, type Draft,
} from "../src/entries";
import { withUncategorized } from "../src/categories";
import type { YearSetup } from "../src/types";
import { sample } from "./helpers";

const file = sample();
const setup: YearSetup = { ...file };
const acct = (id: string) => setup.accounts.find((a) => a.id === id);

function draft(kind: Draft["kind"], fields: Partial<Draft>): Draft {
  return { ...emptyDraft(kind, "2026-03-05", setup), ...fields };
}

describe("emptyDraft", () => {
  it("starts each kind in its Uncategorized category, or none if the year has none", () => {
    const withAll = withUncategorized(setup);
    expect((["expense", "earning", "transfer"] as const).map((k) => emptyDraft(k, "2026-03-05", withAll).cat))
      .toEqual(["ce_uncategorized", "ci_uncategorized", "ct_uncategorized"]);
    const none = { categories: { expense: [], earning: [], transfer: [] } };
    expect(emptyDraft("expense", "2026-03-05", none).cat).toBe("");
  });
});

describe("checkDraft", () => {
  it("turns a complete expense into an entry", () => {
    const r = checkDraft(draft("expense", { item: "  Lunch ", amount: "$1,012.5", account: "a_card", cat: "ce_food", tags: ["t_grocery", "t_grocery"] }), setup, "e_new");
    expect(r).toEqual({
      ok: true,
      entry: { kind: "expense", entry: { id: "e_new", date: "2026-03-05", item: "Lunch", amount: 101250, notes: "", cat: "ce_food", account: "a_card", tags: ["t_grocery"] } },
    });
  });

  it("explains every missing field", () => {
    const r = checkDraft(emptyDraft("expense", "2025-12-31", setup), setup, "e_new");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(["account", "amount", "cat", "date", "item"]);
  });

  it("rejects bad amounts and impossible dates", () => {
    const base = { item: "x", account: "a_card", cat: "ce_food" };
    for (const amount of ["0", "1.234", "-5", "abc"]) {
      const r = checkDraft(draft("expense", { ...base, amount }), setup, "e");
      expect(r.ok ? null : r.errors.amount, amount).toBeTruthy();
    }
    const r = checkDraft(draft("expense", { ...base, amount: "1", date: "2026-02-30" }), setup, "e");
    expect(r.ok ? null : r.errors.date).toBeTruthy();
  });

  it("writes down the person only when it isn't the default", () => {
    const household: YearSetup = { ...setup, members: [{ id: "m_person-a", name: "Person A" }, { id: "m_riya", name: "Riya" }] };
    const base = { item: "Lunch", amount: "12", account: "a_card", cat: "ce_food" };
    const mine = checkDraft(draft("expense", base), household, "e");
    expect(mine.ok && mine.entry.entry).not.toHaveProperty("member");
    const asDefault = checkDraft(draft("expense", { ...base, member: "m_person-a" }), household, "e");
    expect(asDefault.ok && asDefault.entry.entry).not.toHaveProperty("member");
    const hers = checkDraft(draft("transfer", { item: "Pay", amount: "5", from: "a_checking", to: "a_card", cat: "ct_cc", member: "m_riya" }), household, "x");
    expect(hers.ok && hers.entry.entry.member).toBe("m_riya");
    if (!hers.ok) throw new Error("expected ok");
    expect(draftFrom(hers.entry).member).toBe("m_riya");
    const nobody = checkDraft(draft("expense", { ...base, member: "m_gone" }), household, "e");
    expect(nobody.ok ? null : nobody.errors.member).toBeTruthy();
  });

  it("checks transfers go between two different accounts", () => {
    const r = checkDraft(draft("transfer", { item: "Move", amount: "5", from: "a_checking", to: "a_checking", cat: "ct_save" }), setup, "x");
    expect(r.ok ? null : r.errors.to).toBeTruthy();
  });

  it("stores offset targets only for the offset role", () => {
    const refund = checkDraft(draft("earning", { item: "Refund", amount: "5", account: "a_card", cat: "ci_refunds", offsets: "" }), setup, "i");
    expect(refund.ok && refund.entry.entry).toMatchObject({ offsets: null });

    // A paycheck doesn't carry it, even if the draft still has text in it.
    const pay = checkDraft(draft("earning", { item: "Pay", amount: "5", account: "a_checking", cat: "ci_paycheck", offsets: "ce_food" }), setup, "i");
    expect(pay.ok && pay.entry.entry).not.toHaveProperty("offsets");
  });

  it("lets old entries keep an archived account, but not new ones", () => {
    const archived: YearSetup = { ...setup, accounts: setup.accounts.map((a) => (a.id === "a_card" ? { ...a, archived: true } : a)) };
    const fields = { item: "x", amount: "1", account: "a_card", cat: "ce_food" };
    expect(checkDraft(draft("expense", fields), archived, "e").ok).toBe(false);
    expect(checkDraft(draft("expense", { ...fields, id: "e0002" }), archived, "e").ok).toBe(true);
  });

  it("round-trips every fixture entry through the form unchanged", () => {
    const all = [
      ...file.expenses.map((entry) => ({ kind: "expense" as const, entry })),
      ...file.earnings.map((entry) => ({ kind: "earning" as const, entry })),
      ...file.transfers.map((entry) => ({ kind: "transfer" as const, entry })),
    ].filter((e) => e.entry.amount > 0); // the $0 row can't be saved as-is, by design
    for (const e of all) {
      expect(checkDraft(draftFrom(e), setup, "unused"), e.entry.id).toEqual({ ok: true, entry: e });
    }
  });
});

describe("suggestTransferCategory", () => {
  it.each([
    ["a_checking", "a_savings", "ct_save"],
    ["a_savings", "a_checking", "ct_unsave"],
    ["a_checking", "a_card", "ct_cc"],
    ["a_savings", "a_card", "ct_cc"],
    ["a_checking", "a_wallet", "ct_atm"],
    ["a_checking", "a_ira", "ct_ira"],
  ])("%s → %s suggests %s", (from, to, want) => {
    expect(suggestTransferCategory(acct(from), acct(to), setup)).toBe(want);
  });

  it("returns null when no category has the role", () => {
    // The fixture has no "general" transfer category.
    expect(suggestTransferCategory(acct("a_card"), acct("a_wallet"), setup)).toBeNull();
    expect(suggestTransferCategory(undefined, acct("a_wallet"), setup)).toBeNull();
  });
});

describe("ids", () => {
  it("makes new ids that avoid taken ones", () => {
    const id = newId("e", () => false);
    expect(id).toMatch(/^e_[0-9a-z]{8}[0-9a-f]{4}$/);
    // Later ids sort later, and after imported ids like "e0510".
    expect(newId("e", () => false, 1_800_000_000_000) > newId("e", () => false, 1_790_000_000_000)).toBe(true);
    expect(id > "e0510").toBe(true);
    let calls = 0;
    expect(newId("e", () => ++calls < 3)).toMatch(/^e_/);
    expect(calls).toBe(3);
  });

  it("slugs names", () => {
    expect(slug("Movies/Shows")).toBe("movies-shows");
    expect(slug("  Small/Fast Food ")).toBe("small-fast-food");
  });
});

describe("duplicateEntry", () => {
  it("copies every value under a new id, adding (new) to the item", () => {
    const transfer = { kind: "transfer" as const, entry: file.transfers[1]! }; // "To savings"
    expect(duplicateEntry(transfer, "x_copy")).toEqual({
      kind: "transfer",
      entry: { ...file.transfers[1], id: "x_copy", item: "To savings (new)" },
    });
  });

  it("copies tags instead of sharing them", () => {
    const original = { kind: "expense" as const, entry: file.expenses[2]! }; // dinner for two
    const copy = duplicateEntry(original, "e_copy");
    expect(copy.entry).toMatchObject({ item: "Dinner for two (new)", amount: 6000 });
    if (copy.kind !== "expense") throw new Error("kind changed");
    expect(copy.entry.tags).not.toBe(original.entry.tags);
    expect(original.entry.item).toBe("Dinner for two"); // the original is untouched
  });

  it("keeps offset targets on earnings", () => {
    const refund = { kind: "earning" as const, entry: file.earnings[2]! };
    expect(duplicateEntry(refund, "i_copy").entry).toMatchObject({ item: "Grocery refund (new)", offsets: "ce_food" });
  });
});
