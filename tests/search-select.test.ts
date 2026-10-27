import { describe, expect, it } from "vitest";
import { matching } from "../src/views/search-select";

describe("searching a dropdown", () => {
  const choices = [
    { value: "a_checking", label: "Everyday Checking", group: "Bank" },
    { value: "a_card", label: "Rewards Card", group: "Credit cards" },
    { value: "a_store", label: "Store Card", group: "Credit cards" },
  ];

  it("matches part of a name, ignoring case and spaces around it", () => {
    expect(matching(choices, "  CHECK ").map((c) => c.value)).toEqual(["a_checking"]);
  });

  it("matches the group, so a type of account finds all of them", () => {
    expect(matching(choices, "credit").map((c) => c.value)).toEqual(["a_card", "a_store"]);
  });

  it("lists everything for an empty search, and nothing when nothing matches", () => {
    expect(matching(choices, "")).toEqual(choices);
    expect(matching(choices, "zzz")).toEqual([]);
  });
});
