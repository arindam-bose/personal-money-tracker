// Share the tracker: a phone opens its share sheet, a computer copies the link, and closing the
// sheet says nothing.

import { describe, expect, it, vi } from "vitest";
import { SHARE, shareLink, usesSheet, type ShareEnv } from "../src/share";

const abort = () => Object.assign(new Error("Share canceled"), { name: "AbortError" });

describe("shareLink", () => {
  it("opens the share sheet on a phone, and copies nothing", async () => {
    const env: ShareEnv = { share: vi.fn(async () => {}), copy: vi.fn(async () => {}), coarse: true };
    expect(usesSheet(env)).toBe(true);
    expect(await shareLink(SHARE, env)).toBe("shared");
    expect(env.share).toHaveBeenCalledWith(SHARE);
    expect(env.copy).not.toHaveBeenCalled();
  });

  it("says nothing when the sheet is closed without sharing", async () => {
    const env: ShareEnv = { share: vi.fn(async () => { throw abort(); }), copy: vi.fn(async () => {}), coarse: true };
    expect(await shareLink(SHARE, env)).toBe("closed");
    expect(env.copy).not.toHaveBeenCalled();
  });

  it("copies the link when the sheet fails for another reason", async () => {
    const env: ShareEnv = { share: vi.fn(async () => { throw new Error("NotAllowedError"); }), copy: vi.fn(async () => {}), coarse: true };
    expect(await shareLink(SHARE, env)).toBe("copied");
    expect(env.copy).toHaveBeenCalledWith(SHARE.url);
  });

  it("copies the link on a computer, even where the browser has a share dialog", async () => {
    const env: ShareEnv = { share: vi.fn(async () => {}), copy: vi.fn(async () => {}), coarse: false };
    expect(usesSheet(env)).toBe(false);
    expect(await shareLink(SHARE, env)).toBe("copied");
    expect(env.share).not.toHaveBeenCalled();
    expect(env.copy).toHaveBeenCalledWith(SHARE.url);
  });

  it("copies the link on a phone without a share sheet", async () => {
    const env: ShareEnv = { copy: vi.fn(async () => {}), coarse: true };
    expect(usesSheet(env)).toBe(false);
    expect(await shareLink(SHARE, env)).toBe("copied");
  });

  it("fails when the browser won't let the page copy, or can't", async () => {
    expect(await shareLink(SHARE, { copy: async () => { throw new Error("denied"); }, coarse: false })).toBe("failed");
    expect(await shareLink(SHARE, { coarse: false })).toBe("failed");
  });

  it("shares the tracker's own address", () => {
    expect(SHARE.url).toBe("https://arindambose.com/personal-money-tracker/");
  });
});
