// The external-transfer category types: they can be chosen, and files with them import.

import { describe, expect, it } from "vitest";
import { emptyYearFile } from "../src/rollover";
import { blankSetup, saveCategory } from "../src/setup";
import { validateYearFile } from "../src/validate";

describe("external transfer types", () => {
  it("can be picked for expense and earning categories", () => {
    let setup = saveCategory(blankSetup(2026), "expense", { id: "", name: "To my other bank", role: "transfer_out" });
    setup = saveCategory(setup, "earning", { id: "", name: "From my other bank", role: "transfer_in" });
    expect(setup.categories.expense.find((c) => c.name === "To my other bank")!.role).toBe("transfer_out");
    expect(setup.categories.earning.find((c) => c.name === "From my other bank")!.role).toBe("transfer_in");
    // Only paycheck and income keep an unticked Net.
    setup = saveCategory(setup, "earning", { id: "", name: "Moved in", role: "transfer_in", net: false });
    expect(setup.categories.earning.find((c) => c.name === "Moved in")!.net).toBeUndefined();
  });

  it("aren't swapped between kinds", () => {
    expect(() => saveCategory(blankSetup(2026), "expense", { id: "", name: "Wrong", role: "transfer_in" })).toThrow();
    expect(() => saveCategory(blankSetup(2026), "earning", { id: "", name: "Wrong", role: "transfer_out" })).toThrow();
  });

  it("new years start with Transfer to external account as one, and the file checks out", () => {
    const setup = blankSetup(2026);
    expect(setup.categories.expense.find((c) => c.name === "Transfer to external account")!.role).toBe("transfer_out");
    const withIn = saveCategory(setup, "earning", { id: "", name: "From my other bank", role: "transfer_in" });
    expect(validateYearFile(emptyYearFile(withIn)).ok).toBe(true);
  });
});
