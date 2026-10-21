import { describe, expect, it } from "vitest";
import { validateYearFile } from "../src/validate";
import { sample } from "./helpers";

/** Validate a copy of the sample after applying a change to it. */
function errorsAfter(change: (f: any) => void): string[] {
  const f = sample();
  change(f);
  const r = validateYearFile(f);
  return r.ok ? [] : r.errors;
}

describe("validateYearFile", () => {
  it("accepts the sample file", () => {
    expect(validateYearFile(sample())).toMatchObject({ ok: true });
  });

  it("rejects files that aren't money-tracker files", () => {
    expect(validateYearFile([])).toMatchObject({ ok: false });
    expect(validateYearFile({ app: "other" })).toMatchObject({ ok: false });
    expect(errorsAfter((f) => (f.schema = 2))).toEqual(["Unsupported file version: 2."]);
  });

  it("catches broken references", () => {
    expect(errorsAfter((f) => (f.expenses[0].account = "a_gone"))).toEqual([
      'Expense "e0001" uses unknown account "a_gone".',
    ]);
    expect(errorsAfter((f) => f.expenses[1].tags.push("t_gone"))).toEqual(['Expense "e0002" uses unknown tag "t_gone".']);
    expect(errorsAfter((f) => (f.earnings[2].offsets = "ce_gone"))).toHaveLength(1);
    expect(errorsAfter((f) => (f.transfers[0].to = "a_checking"))).toEqual([
      'Transfer "x0001" goes from an account to itself.',
    ]);
  });

  it("requires whole-cent amounts and dates inside the year", () => {
    expect(errorsAfter((f) => (f.expenses[0].amount = 12.5))).toHaveLength(1);
    expect(errorsAfter((f) => (f.expenses[0].amount = -100))).toHaveLength(1);
    expect(errorsAfter((f) => (f.expenses[0].date = "2025-12-31"))).toHaveLength(1);
    expect(errorsAfter((f) => (f.expenses[0].date = "2026-02-30"))).toHaveLength(1);
  });

  it("requires roles on earning and transfer categories", () => {
    expect(errorsAfter((f) => delete f.categories.earning[0].role)).toEqual(['earning category "Paycheck" has no role.']);
    expect(errorsAfter((f) => (f.categories.transfer[0].role = "nope"))).toHaveLength(1);
    expect(errorsAfter((f) => delete f.categories.expense[2].role)).toEqual([]);
  });

  it("allows net only as a boolean on earning categories", () => {
    expect(errorsAfter((f) => (f.categories.earning[1].net = false))).toEqual([]);
    expect(errorsAfter((f) => (f.categories.earning[1].net = "no"))).toHaveLength(1);
    expect(errorsAfter((f) => (f.categories.expense[0].net = false))).toHaveLength(1);
  });

  it("catches duplicate ids and a bad owed share", () => {
    expect(errorsAfter((f) => (f.expenses[1].id = "e0001"))).toEqual(['Expense id "e0001" is used twice.']);
    expect(errorsAfter((f) => (f.expenses[2].owed.amount = 999999))).toHaveLength(1);
  });

  it("reports every problem, not just the first", () => {
    const errors = errorsAfter((f) => {
      f.expenses[0].cat = "ce_gone";
      f.earnings[0].account = "a_gone";
      f.budgets.default.ce_gone = 100;
    });
    expect(errors).toHaveLength(3);
  });
});
