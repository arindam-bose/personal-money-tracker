// Cookie settings hands itself to the banner it opens, so focus can go back there once answered,
// even in browsers that don't focus a button they click (Safari and Firefox on a Mac).

import { describe, expect, it } from "vitest";
import { consentAsked, openConsent, takeConsentOpener } from "../src/analytics";

describe("openConsent", () => {
  it("asks again, and keeps the control that asked for the banner to take, once", () => {
    const button = { tagName: "BUTTON" } as unknown as HTMLElement;
    openConsent(button);
    expect(consentAsked.value).toBe(true);
    expect(takeConsentOpener()).toBe(button);
    expect(takeConsentOpener()).toBeNull();
  });

  it("has no opener when nothing handed one over", () => {
    openConsent();
    expect(takeConsentOpener()).toBeNull();
  });
});
