import { describe, expect, it } from "vitest";
import {
  DEFAULT_MEMBER, SetupError, blankSetup, deleteMember, memberUses, membersOf, saveMember, withoutPeople, deleteAccount, duplicateAccount, deleteCategory, deleteTag, saveAccount, saveCategory,
  saveTag, uncategorizedId, usageOf, withUncategorized,
} from "../src/setup";
import type { YearSetup } from "../src/types";
import { validateYearFile } from "../src/validate";
import { sample } from "./helpers";

const file = sample();
const setup: YearSetup = { ...file };
const usage = usageOf(file);
const data = { setup, expenses: file.expenses, earnings: file.earnings, transfers: file.transfers };

describe("usageOf", () => {
  it("counts every reference", () => {
    expect(usage.accounts.get("a_card")).toBe(7); // 4 expenses + 2 refunds + 1 card payment
    expect(usage.categories.get("ce_food")).toBe(6); // 5 food expenses + 1 refund aimed at Food
    expect(usage.tags.get("t_grocery")).toBe(1);
    expect(usage.accounts.get("a_ira")).toBe(1);
  });
});

describe("accounts", () => {
  it("duplicates an account as <name>_new, right below it", () => {
    const card = setup.accounts.find((a) => a.id === "a_card")!;
    const r = duplicateAccount({ ...setup, accounts: setup.accounts.map((a) => (a.id === "a_card" ? { ...a, archived: true } : a)) }, "a_card");
    const at = r.setup.accounts.findIndex((a) => a.id === "a_card");
    expect(r.setup.accounts[at + 1]).toEqual({ ...card, id: r.id, name: `${card.name}_new` });
    expect(r.setup.accounts).toHaveLength(setup.accounts.length + 1);
    // A second copy can't take the same name.
    const again = duplicateAccount(r.setup, "a_card");
    expect(again.setup.accounts.find((a) => a.id === again.id)!.name).toBe(`${card.name}_new2`);
    expect(new Set(again.setup.accounts.map((a) => a.id)).size).toBe(again.setup.accounts.length);
  });

  it("adds an account with an id from its name", () => {
    const s = saveAccount(setup, { id: "", name: " Joint Checking ", type: "checking", ref: "**9", opening: 100 });
    expect(s.accounts.at(-1)).toEqual({ id: "a_joint-checking", name: "Joint Checking", type: "checking", ref: "**9", opening: 100 });
  });

  it("renames in place, keeping the id", () => {
    const card = setup.accounts.find((a) => a.id === "a_card")!;
    const s = saveAccount(setup, { ...card, name: "Visa" });
    expect(s.accounts.find((a) => a.id === "a_card")!.name).toBe("Visa");
    expect(s.accounts).toHaveLength(setup.accounts.length);
  });

  it("checks names, limits and amounts", () => {
    const base = { id: "", ref: "", opening: 0 } as const;
    expect(() => saveAccount(setup, { ...base, name: "checking", type: "checking" })).toThrow(SetupError);
    expect(() => saveAccount(setup, { ...base, name: "New card", type: "credit" })).toThrow("credit limit");
    expect(() => saveAccount(setup, { ...base, name: "  ", type: "cash" })).toThrow("name");
    expect(() => saveAccount(setup, { ...base, name: "X", type: "cash", opening: 1.5 })).toThrow("opening");
    // A limit is dropped from non-credit accounts.
    expect(saveAccount(setup, { ...base, name: "Y", type: "cash", limit: 5 }).accounts.at(-1)).not.toHaveProperty("limit");
  });

  it("deletes only unused accounts", () => {
    expect(() => deleteAccount(setup, "a_card", usage)).toThrow("Hide it instead");
    const s = saveAccount(setup, { id: "", name: "Spare", type: "cash", ref: "", opening: 0 });
    expect(deleteAccount(s, "a_spare", usage).accounts).toHaveLength(setup.accounts.length);
  });
});

describe("categories", () => {
  it("requires a role for earnings and transfers, not expenses", () => {
    expect(saveCategory(setup, "expense", { id: "", name: "Pets" }).categories.expense.at(-1)).toEqual({ id: "ce_pets", name: "Pets" });
    expect(() => saveCategory(setup, "earning", { id: "", name: "Gifts" })).toThrow("Pick what this category is for");
    expect(saveCategory(setup, "earning", { id: "", name: "Gifts", role: "income" }).categories.earning.at(-1)!.role).toBe("income");
    expect(() => saveCategory(setup, "transfer", { id: "", name: "Odd", role: "nope" })).toThrow();
  });

  it("keeps net: false only on paycheck and income earning categories", () => {
    const off = saveCategory(setup, "earning", { id: "ci_interest", name: "Interest", role: "income", net: false });
    expect(off.categories.earning.find((c) => c.id === "ci_interest")).toEqual({ id: "ci_interest", name: "Interest", role: "income", net: false });
    const on = saveCategory(off, "earning", { id: "ci_interest", name: "Interest", role: "income", net: true });
    expect(on.categories.earning.find((c) => c.id === "ci_interest")).not.toHaveProperty("net");
    const refund = saveCategory(setup, "earning", { id: "ci_refunds", name: "Refunds", role: "offset", net: false });
    expect(refund.categories.earning.find((c) => c.id === "ci_refunds")).not.toHaveProperty("net");
  });

  it("deleting a category drops its budget targets too", () => {
    const r = deleteCategory(data, "expense", "ce_rent");
    expect(r.setup.categories.expense.map((c) => c.id)).not.toContain("ce_rent");
    expect(r.setup.budgets.default).toEqual({ ce_food: 40000 });
  });

  it("moves a deleted category's entries to Uncategorized, adding it if missing", () => {
    const r = deleteCategory(data, "expense", "ce_food");
    expect(r.setup.categories.expense.map((c) => c.id)).toEqual(["ce_rent", "ce_charity", "ce_loan", "ce_uncategorized"]);
    expect(r.expenses.map((e) => [e.id, e.cat])).toEqual(
      ["e0002", "e0003", "e0004", "e0005", "e0008"].map((id) => [id, "ce_uncategorized"]),
    );
    // The refund aimed at Food now lowers Uncategorized instead.
    expect(r.earnings.map((i) => [i.id, i.offsets])).toEqual([["i0003", "ce_uncategorized"]]);
    expect(r.transfers).toEqual([]);
    expect(r.setup.budgets["2026-02"]).toEqual({});

    const t = deleteCategory(data, "transfer", "ct_atm");
    expect(t.transfers.map((x) => [x.id, x.cat])).toEqual([["x0004", "ct_uncategorized"]]);
    expect(t.setup.categories.transfer.find((c) => c.id === "ct_uncategorized")!.role).toBe("general");

    const i = deleteCategory(data, "earning", "ci_interest");
    expect(i.earnings.map((x) => [x.id, x.cat])).toEqual([["i0002", "ci_uncategorized"]]);
    expect(i.setup.categories.earning.at(-1)).toEqual({ id: "ci_uncategorized", name: "Uncategorized", role: "income", net: false });
  });

  it("keeps the result a valid year file", () => {
    const r = deleteCategory(data, "expense", "ce_food");
    const byId = new Map(r.expenses.map((e) => [e.id, e]));
    const earnings = new Map(r.earnings.map((e) => [e.id, e]));
    const moved = {
      ...file, ...r.setup,
      expenses: file.expenses.map((e) => byId.get(e.id) ?? e),
      earnings: file.earnings.map((e) => earnings.get(e.id) ?? e),
    };
    const v = validateYearFile(moved);
    expect(v.ok ? [] : v.errors).toEqual([]);
  });

  it("never deletes Uncategorized, or an Uncategorized the user already had", () => {
    const once = deleteCategory(data, "expense", "ce_food");
    expect(() => deleteCategory({ ...data, setup: once.setup }, "expense", "ce_uncategorized")).toThrow("can't be deleted");
    const own = saveCategory(setup, "expense", { id: "", name: "uncategorized" });
    expect(withUncategorized(own).categories.expense).toHaveLength(own.categories.expense.length);
    const r = deleteCategory({ ...data, setup: own }, "expense", "ce_rent");
    expect(r.expenses[0]!.cat).toBe(uncategorizedId(own, "expense"));
  });
});

describe("tags", () => {
  it("adds, renames and keeps tags sorted", () => {
    let s = saveTag(setup, { id: "", name: "Coffee" });
    expect(s.tags.map((t) => t.name)).toEqual(["Abroad", "Coffee", "Grocery"]);
    s = saveTag(s, { id: "t_coffee", name: "Cafés" });
    expect(s.tags.map((t) => t.id)).toEqual(["t_abroad", "t_coffee", "t_grocery"]);
    expect(() => saveTag(s, { id: "", name: "grocery" })).toThrow("already");
  });

  it("deletes a used tag by taking it off its expenses", () => {
    const r = deleteTag({ setup, expenses: file.expenses }, "t_grocery");
    expect(r.setup.tags.map((t) => t.id)).not.toContain("t_grocery");
    expect(r.expenses).toHaveLength(1);
    expect(r.expenses[0]!.tags).not.toContain("t_grocery");
    const before = file.expenses.find((e) => e.id === r.expenses[0]!.id)!;
    expect(r.expenses[0]).toEqual({ ...before, tags: before.tags.filter((t) => t !== "t_grocery") });
  });

});

describe("withoutPeople", () => {
  it("drops people, owed shares and the reimbursement role from an older year", () => {
    const old = {
      setup: { ...setup, people: [{ id: "p_sam", name: "Sam" }] } as YearSetup,
      expenses: file.expenses.map((e) => (e.id === "e0003" ? { ...e, owed: { person: "p_sam", amount: 3000 } } : e)),
      earnings: file.earnings.map((i) => (i.id === "i0005" ? { ...i, person: "p_sam" } : i)),
    };
    old.setup.categories = { ...setup.categories, earning: setup.categories.earning.map((c) => (c.id === "ci_payback" ? { ...c, role: "reimbursement" as never } : c)) };
    const r = withoutPeople(old)!;
    expect(r.setup).not.toHaveProperty("people");
    expect(r.setup.categories.earning.find((c) => c.id === "ci_payback")!.role).toBe("offset");
    expect(r.expenses).toEqual([file.expenses.find((e) => e.id === "e0003")]);
    expect(r.earnings).toEqual([file.earnings.find((i) => i.id === "i0005")]);
  });

  it("leaves an up-to-date year alone", () => {
    expect(withoutPeople({ setup, expenses: file.expenses, earnings: file.earnings })).toBeNull();
  });
});

describe("blankSetup", () => {
  it("is a valid empty year with every role covered", () => {
    const s = blankSetup(2027);
    const r = validateYearFile({ app: "money-tracker", schema: 1, exportedAt: "", ...s, expenses: [], earnings: [], transfers: [] });
    expect(r.ok ? [] : r.errors).toEqual([]);
    expect(new Set(s.categories.earning.map((c) => c.role))).toEqual(new Set(["paycheck", "income", "offset"]));
    expect(s.categories.transfer).toHaveLength(9); // the 8 standard ones + Uncategorized
    expect(s.categories.transfer.find((c) => c.role === "loan_payment")).toEqual({ id: "ct_loan-payments", name: "Loan Payments", role: "loan_payment" });
    expect(s.categories.expense.some((c) => c.name === "Loan")).toBe(false);
    expect(["expense", "earning", "transfer"].map((k) => uncategorizedId(s, k as "expense"))).toEqual(["ce_uncategorized", "ci_uncategorized", "ct_uncategorized"]);
    expect(s.categories.earning.find((c) => c.name === "Other")!.net).toBe(false);
  });
});

describe("members", () => {
  it("starts with Person A, who owns every entry", () => {
    expect(membersOf(setup)).toEqual([DEFAULT_MEMBER]);
    expect(memberUses(setup, usage, DEFAULT_MEMBER.id)).toBe(file.expenses.length + file.earnings.length + file.transfers.length);
  });

  it("adds and renames people; names stay unique", () => {
    let s = saveMember(setup, { id: "", name: "Riya" });
    expect(s.members).toEqual([DEFAULT_MEMBER, { id: "m_riya", name: "Riya" }]);
    s = saveMember(s, { id: DEFAULT_MEMBER.id, name: "Arin" });
    expect(membersOf(s).map((m) => m.name)).toEqual(["Arin", "Riya"]);
    expect(() => saveMember(s, { id: "", name: "riya" })).toThrow("already");
  });

  it("deleting someone gives their entries back to the default person", () => {
    const withRiya = saveMember(setup, { id: "", name: "Riya" });
    const data = {
      setup: withRiya,
      expenses: file.expenses.map((e) => (e.id === "e0002" ? { ...e, member: "m_riya" } : e)),
      earnings: file.earnings,
      transfers: file.transfers.map((t) => (t.id === "x0001" ? { ...t, member: "m_riya" } : t)),
    };
    expect(memberUses(withRiya, usageOf(data), "m_riya")).toBe(2);
    const r = deleteMember(data, "m_riya");
    expect(r.setup.members).toEqual([DEFAULT_MEMBER]);
    expect(r.expenses).toEqual([file.expenses.find((e) => e.id === "e0002")]);
    expect(r.transfers).toEqual([file.transfers.find((t) => t.id === "x0001")]);
    expect(() => deleteMember(data, DEFAULT_MEMBER.id)).toThrow("can't be deleted");
  });
});
