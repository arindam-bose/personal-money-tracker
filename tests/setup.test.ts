import { describe, expect, it } from "vitest";
import {
  SetupError, blankSetup, deleteAccount, deleteCategory, deletePerson, deleteTag, saveAccount, saveCategory,
  savePerson, saveTag, usageOf,
} from "../src/setup";
import type { YearSetup } from "../src/types";
import { validateYearFile } from "../src/validate";
import { sample } from "./helpers";

const file = sample();
const setup: YearSetup = { ...file };
const usage = usageOf(file);

describe("usageOf", () => {
  it("counts every reference", () => {
    expect(usage.accounts.get("a_card")).toBe(7); // 4 expenses + 2 refunds + 1 card payment
    expect(usage.categories.get("ce_food")).toBe(6); // 5 food expenses + 1 refund aimed at Food
    expect(usage.tags.get("t_grocery")).toBe(1);
    expect(usage.people.get("p_sam")).toBe(2); // owed share + payback
    expect(usage.accounts.get("a_ira")).toBe(1);
  });
});

describe("accounts", () => {
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
    expect(() => deleteAccount(setup, "a_card", usage)).toThrow("Archive it instead");
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

  it("deleting an unused category drops its budget targets too", () => {
    const s = deleteCategory(setup, "expense", "ce_rent", { ...usage, categories: new Map() });
    expect(s.categories.expense.map((c) => c.id)).not.toContain("ce_rent");
    expect(s.budgets.default).toEqual({ ce_food: 40000 });
    expect(() => deleteCategory(setup, "expense", "ce_rent", usage)).toThrow("used by 1 entry");
  });
});

describe("tags and people", () => {
  it("adds, renames and keeps tags sorted", () => {
    let s = saveTag(setup, { id: "", name: "Coffee" });
    expect(s.tags.map((t) => t.name)).toEqual(["Abroad", "Coffee", "Grocery"]);
    s = saveTag(s, { id: "t_coffee", name: "Cafés" });
    expect(s.tags.map((t) => t.id)).toEqual(["t_abroad", "t_coffee", "t_grocery"]);
    expect(() => saveTag(s, { id: "", name: "grocery" })).toThrow("already");
  });

  it("deletes only unused tags and people", () => {
    expect(() => deleteTag(setup, "t_grocery", usage)).toThrow("on 1 entry");
    expect(() => deletePerson(setup, "p_sam", usage)).toThrow("on 2 entries");
    const s = savePerson(setup, { id: "", name: "Alex" });
    expect(deletePerson(s, "p_alex", usage).people).toEqual(setup.people);
  });
});

describe("blankSetup", () => {
  it("is a valid empty year with every role covered", () => {
    const s = blankSetup(2027);
    const r = validateYearFile({ app: "money-tracker", schema: 1, exportedAt: "", ...s, expenses: [], earnings: [], transfers: [] });
    expect(r.ok ? [] : r.errors).toEqual([]);
    expect(new Set(s.categories.earning.map((c) => c.role))).toEqual(new Set(["paycheck", "income", "offset", "reimbursement"]));
    expect(s.categories.transfer).toHaveLength(7);
    expect(s.categories.earning.find((c) => c.name === "Other")!.net).toBe(false);
  });
});
