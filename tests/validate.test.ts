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

  it("checks the last-updated time when there is one", () => {
    expect(errorsAfter((f) => (f.lastChangedAt = "2026-10-26T22:16:00.000Z"))).toEqual([]);
    expect(errorsAfter((f) => (f.lastChangedAt = "yesterday"))).toEqual([`"lastChangedAt" must be a date and time, like "2026-10-26T22:16:00.000Z".`]);
    // Strings Date.parse would take, but that aren't timestamps.
    for (const loose of ["1", "May 2026", "2026-10-26"]) expect(errorsAfter((f) => (f.lastChangedAt = loose))).toHaveLength(1);
    expect(errorsAfter((f) => (f.setupChangedAt = "2026-10-27T08:30:00.000Z"))).toEqual([]);
    expect(errorsAfter((f) => (f.setupChangedAt = "yesterday"))).toEqual([`"setupChangedAt" must be a date and time, like "2026-10-26T22:16:00.000Z".`]);
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

  it("checks members and who entries belong to", () => {
    const members = [{ id: "m_person-a", name: "Person A" }, { id: "m_riya", name: "Riya" }];
    expect(errorsAfter((f) => { f.members = members; f.expenses[0].member = "m_riya"; })).toEqual([]);
    expect(errorsAfter((f) => { f.members = members; f.earnings[0].member = "m_gone"; }))
      .toEqual(['Earning "i0001" belongs to unknown member "m_gone".']);
    expect(errorsAfter((f) => (f.transfers[0].member = "m_riya"))).toHaveLength(1); // no members listed
  });

  it("checks closed, the IRA limit and settings when they are there", () => {
    expect(errorsAfter((f) => { f.closed = true; f.iraLimit = 750000; f.settings = { pinnedTags: ["t_x"], pinnedYearTags: ["t_y"] }; })).toEqual([]);
    expect(errorsAfter((f) => (f.closed = "yes"))).toEqual(['"closed" must be true or false.']);
    expect(errorsAfter((f) => (f.iraLimit = 7500.5))).toEqual(['"iraLimit" is not whole cents.']);
    expect(errorsAfter((f) => (f.iraLimit = -1))).toEqual(['"iraLimit" is not whole cents.']);
    expect(errorsAfter((f) => (f.settings = []))).toEqual(['"settings" must be an object.']);
    expect(errorsAfter((f) => (f.settings = { pinnedTags: "t_x" }))).toEqual(['"settings.pinnedTags" must be a list of tag ids.']);
    expect(errorsAfter((f) => (f.settings = { pinnedYearTags: [1] }))).toEqual(['"settings.pinnedYearTags" must be a list of tag ids.']);
  });

  it("catches duplicate ids", () => {
    expect(errorsAfter((f) => (f.expenses[1].id = "e0001"))).toEqual(['Expense id "e0001" is used twice.']);
  });

  it("still imports a file from when there were people, without them", () => {
    const old = sample() as unknown as Record<string, any>;
    old.people = [{ id: "p_sam", name: "Sam" }];
    old.expenses[2].owed = { person: "p_sam", amount: 3000 };
    old.earnings[4].person = "p_sam";
    old.categories.earning[3].role = "reimbursement";
    const r = validateYearFile(old);
    if (!r.ok) throw new Error(r.errors.join("; "));
    expect(r.file).toEqual(sample()); // the fixture is that same file, already without people
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
