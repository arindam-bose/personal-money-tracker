// The home-screen steps: each browser gets its own words for Add to Home Screen.

import { describe, expect, it } from "vitest";
import { installSteps, stateAfterPrompt, type Step } from "../src/install";

/** The steps as one line, with the bold parts in *stars*. */
const text = (steps: Step[]) => steps.map((s) => (typeof s === "string" ? s : `*${s.b}*`)).join("");

describe("installSteps", () => {
  it("points iPhones and iPads to the Share menu", () => {
    expect(text(installSteps({ browser: "Safari", system: "iPhone" }))).toBe("Tap Safari's *Share* button, then *Add to Home Screen*.");
    expect(text(installSteps({ browser: "Chrome", system: "iPad" }))).toBe("Open Chrome's *Share* menu, then choose *Add to Home Screen*.");
  });

  it("uses each Android browser's own words", () => {
    expect(text(installSteps({ browser: "Chrome", system: "Android" }))).toMatch(/three-dot menu.*\*Add to Home screen\*.*\*Install\*/);
    expect(text(installSteps({ browser: "Samsung Internet", system: "Android" }))).toBe("Open the menu, choose *Add page to*, then *Home screen*.");
  });

  it("sends computers to the address bar, the Dock, or another browser", () => {
    expect(text(installSteps({ browser: "Edge", system: "Windows" }))).toMatch(/address bar.*\*Install\* in Edge's menu/);
    expect(text(installSteps({ browser: "Safari", system: "Mac" }))).toBe("In Safari's *File* menu, choose *Add to Dock*.");
    expect(text(installSteps({ browser: "Firefox", system: "Linux" }))).toMatch(/can't install a site/);
    expect(text(installSteps({ browser: null, system: null }))).toMatch(/\*Install\*/);
  });
});

describe("stateAfterPrompt", () => {
  it("counts a yes as installed, without waiting for the browser to say so", () => {
    expect(stateAfterPrompt("accepted", false)).toBe("installed");
  });

  it("shows the steps after a no, or when the browser wouldn't prompt", () => {
    expect(stateAfterPrompt("dismissed", false)).toBe("manual");
    expect(stateAfterPrompt("unavailable", false)).toBe("manual");
  });

  it("offers Install again when the browser sent a fresh prompt while this one was open", () => {
    expect(stateAfterPrompt("dismissed", true)).toBe("prompt");
    expect(stateAfterPrompt("unavailable", true)).toBe("prompt");
  });
});
