import { describe, expect, it } from "vitest";
import {
  checkDraft, draftFrom, duplicateEntry, emptyDraft, newId, slug, suggestTransferCategory, type Draft,
} from "../src/entries";
import type { YearSetup } from "../src/types";
import { sample } from "./helpers";

const file = sample();
const setup: YearSetup = { ...file, people: file.people ?? [] };
const acct = (id: string) => setup.accounts.find((a) => a.id === id);

function draft(kind: Draft["kind"], fields: Partial<Draft>): Draft {
  return { ...emptyDraft(kind, "2026-03-05"), ...fields };
}

describe("checkDraft", () => {
  it("turns a complete expense into an entry", () => {
    const r = checkDraft(draft("expense", { item: "  Lunch ", amount: "$1,012.5", account: "a_card", cat: "ce_food", tags: ["t_grocery", "t_grocery"] }), setup, "e_new");
    expect(r).toEqual({
      ok: true,
      entry: { kind: "expense", entry: { id: "e_new", date: "2026-03-05", item: "Lunch", amount: 101250, notes: "", cat: "ce_food", account: "a_card", tags: ["t_grocery"] } },
    });
  });

  it("explains every missing field", () => {
    const r = checkDraft(emptyDraft("expense", "2025-12-31"), setup, "e_new");
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

  it("keeps the owed share within the amount", () => {
    const base = { item: "Dinner", amount: "60", account: "a_card", cat: "ce_food", owedPerson: "p_sam" };
    const ok = checkDraft(draft("expense", { ...base, owedAmount: "30" }), setup, "e");
    expect(ok.ok && ok.entry.kind === "expense" && ok.entry.entry.owed).toEqual({ person: "p_sam", amount: 3000 });
    const tooMuch = checkDraft(draft("expense", { ...base, owedAmount: "61" }), setup, "e");
    expect(tooMuch.ok ? null : tooMuch.errors.owedAmount).toBeTruthy();
  });

  it("checks transfers go between two different accounts", () => {
    const r = checkDraft(draft("transfer", { item: "Move", amount: "5", from: "a_checking", to: "a_checking", cat: "ct_save" }), setup, "x");
    expect(r.ok ? null : r.errors.to).toBeTruthy();
  });

  it("stores offset targets and reimbursement people only for those roles", () => {
    const refund = checkDraft(draft("earning", { item: "Refund", amount: "5", account: "a_card", cat: "ci_refunds", offsets: "" }), setup, "i");
    expect(refund.ok && refund.entry.entry).toMatchObject({ offsets: null });

    const payback = checkDraft(draft("earning", { item: "Back", amount: "5", account: "a_checking", cat: "ci_payback" }), setup, "i");
    expect(payback.ok ? null : payback.errors.person).toBeTruthy();

    // A paycheck carries neither field, even if the draft still has text in them.
    const pay = checkDraft(draft("earning", { item: "Pay", amount: "5", account: "a_checking", cat: "ci_paycheck", offsets: "ce_food", person: "p_sam" }), setup, "i");
    expect(pay.ok && pay.entry.entry).not.toHaveProperty("offsets");
    expect(pay.ok && pay.entry.entry).not.toHaveProperty("person");
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
  it("copies every value under a new id, adding -new to the item", () => {
    const transfer = { kind: "transfer" as const, entry: file.transfers[1]! }; // "To savings"
    expect(duplicateEntry(transfer, "x_copy")).toEqual({
      kind: "transfer",
      entry: { ...file.transfers[1], id: "x_copy", item: "To savings-new" },
    });
  });

  it("copies tags and owed shares instead of sharing them", () => {
    const original = { kind: "expense" as const, entry: file.expenses[2]! }; // dinner with Sam's share
    const copy = duplicateEntry(original, "e_copy");
    expect(copy.entry).toMatchObject({ item: "Dinner for two-new", amount: 6000, owed: { person: "p_sam", amount: 3000 } });
    if (copy.kind !== "expense") throw new Error("kind changed");
    expect(copy.entry.tags).not.toBe(original.entry.tags);
    expect(copy.entry.owed).not.toBe(original.entry.owed);
    expect(original.entry.item).toBe("Dinner for two"); // the original is untouched
  });

  it("keeps offset targets and people on earnings", () => {
    const refund = { kind: "earning" as const, entry: file.earnings[2]! };
    expect(duplicateEntry(refund, "i_copy").entry).toMatchObject({ item: "Grocery refund-new", offsets: "ce_food" });
  });
});
