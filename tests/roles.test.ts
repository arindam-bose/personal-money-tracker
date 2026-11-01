// The external-transfer category type: it can be chosen, and files with it import. The old
// expense one ("transfer_out", before 4.0.1) becomes a regular category.

import { describe, expect, it } from "vitest";
import { emptyYearFile } from "../src/rollover";
import { blankSetup, saveCategory, withoutPeople } from "../src/setup";
import { validateYearFile } from "../src/validate";

describe("external transfer types", () => {
  it("can be picked for earning categories", () => {
    let setup = saveCategory(blankSetup(2026), "earning", { id: "", name: "From my other bank", role: "transfer_in" });
    expect(setup.categories.earning.find((c) => c.name === "From my other bank")!.role).toBe("transfer_in");
    // Only paycheck and income keep an unticked Net.
    setup = saveCategory(setup, "earning", { id: "", name: "Moved in", role: "transfer_in", net: false });
    expect(setup.categories.earning.find((c) => c.name === "Moved in")!.net).toBeUndefined();
  });

  it("aren't swapped between kinds", () => {
    expect(() => saveCategory(blankSetup(2026), "expense", { id: "", name: "Wrong", role: "transfer_in" })).toThrow();
    expect(() => saveCategory(blankSetup(2026), "expense", { id: "", name: "Wrong", role: "transfer_out" as never })).toThrow();
  });

  it("new years start with a regular Transfer to external account, and the file checks out", () => {
    const setup = blankSetup(2026);
    expect(setup.categories.expense.find((c) => c.name === "Transfer to external account")!.role).toBeUndefined();
    const withIn = saveCategory(setup, "earning", { id: "", name: "From my other bank", role: "transfer_in" });
    expect(validateYearFile(emptyYearFile(withIn)).ok).toBe(true);
  });
});

describe("years from before Transfer to external counted in net spending", () => {
  it("make its category regular, on import and when opened", () => {
    const old = blankSetup(2026);
    const withRole = { ...old, categories: { ...old.categories, expense: [...old.categories.expense, { id: "ce_out", name: "Sent abroad", role: "transfer_out" as never }] } };
    const r = validateYearFile(emptyYearFile(withRole));
    expect(r.ok && r.file.categories.expense.find((c) => c.id === "ce_out")).toEqual({ id: "ce_out", name: "Sent abroad" });
    const opened = withoutPeople({ setup: withRole, expenses: [], earnings: [] });
    expect(opened!.setup.categories.expense.find((c) => c.id === "ce_out")).toEqual({ id: "ce_out", name: "Sent abroad" });
  });
});
