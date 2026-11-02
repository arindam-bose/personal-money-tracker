// A Dashboard tile's stripe and its Over the years chart take one colour, from concepts.ts.
// The charts read CONCEPT_TOKEN directly; this checks style.css draws each stripe with the same token.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CONCEPT_TOKEN, surplusConcept } from "../src/views/concepts";

describe("figure colours", () => {
  const css = readFileSync(new URL("../src/style.css", import.meta.url), "utf8");

  it("gives every concept a tile stripe in its own colour token", () => {
    for (const [concept, token] of Object.entries(CONCEPT_TOKEN)) {
      expect(css, concept).toContain(`.tile-${concept} { border-left: 3px solid var(${token}); }`);
    }
  });

  it("colours a surplus green, and a shortfall red", () => {
    expect(surplusConcept(100)).toBe("gain");
    expect(surplusConcept(0)).toBe("gain");
    expect(surplusConcept(-1)).toBe("loss");
  });
});
