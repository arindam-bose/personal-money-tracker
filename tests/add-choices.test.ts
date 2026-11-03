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

  it("offers only an account while no account can take an entry", () => {
    const only = (a: object) => addChoices({ ...withAccounts, accounts: [a] } as unknown as YearSetup);
    expect(only({ id: "a", name: "Car", type: "asset" })).toEqual(["account"]);
    expect(only({ id: "a", name: "Mortgage", type: "loan" })).toEqual(["account"]);
    expect(only({ id: "a", name: "Old", type: "checking", archived: true })).toEqual(["account"]);
    expect(only({ id: "a", name: "Gone", type: "checking", closedOn: "2025-03-01" })).toEqual(["account"]);
    expect(only({ id: "a", name: "Bank", type: "checking" })).toEqual(["transaction", "account"]);
  });

  it("is not there for a closed year, which takes no changes", () => {
    expect(addChoices({ ...withAccounts, closed: true })).toEqual([]);
  });
});
