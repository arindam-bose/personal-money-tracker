import { describe, expect, it } from "vitest";
import { demoYear } from "../src/demo";
import { addChoices } from "../src/setup";
import type { YearSetup } from "../src/types";

const { accounts, categories, tags, year } = demoYear(2025);
const withAccounts = { accounts, categories, tags, year } as unknown as YearSetup;

describe("what the Add button offers", () => {
  it("is not there without a year", () => {
    expect(addChoices(undefined)).toEqual([]);
  });

  it("offers only an account while the year has none", () => {
    expect(addChoices({ ...withAccounts, accounts: [] })).toEqual(["account"]);
  });

  it("offers a transaction and an account once there is an account", () => {
    expect(addChoices(withAccounts)).toEqual(["transaction", "account"]);
  });

  it("is not there for a closed year, which takes no changes", () => {
    expect(addChoices({ ...withAccounts, closed: true })).toEqual([]);
  });
});
