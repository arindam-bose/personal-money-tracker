// Passing the tracker on, from the Support card on the Settings page. As in the Habit Tracker and the
// RDR2 Crafting Guide: a phone gets its own share sheet, the way any app shares a link; a computer
// gets the link copied, since a desktop share dialog (Edge, Safari) is a detour when all anyone wants
// there is to paste it.

export interface ShareInfo {
  title: string;
  text: string;
  url: string;
}

/** What Share hands on: the canonical address, and a line to go with it for the sheets that show one. */
export const SHARE: ShareInfo = {
  title: "Money Tracker",
  text: "Track what you earn, spend, save and invest, with budgets and reports. Free, private, and it works offline.",
  url: "https://arindambose.com/personal-money-tracker/",
};

/** Where Buy me a coffee goes: a plain link, so nothing of that site loads until it is followed. */
export const COFFEE_URL = "https://buymeacoffee.com/arindambose";

/** The parts of the browser sharing needs, apart so the tests can stand in for them. */
export interface ShareEnv {
  /** The share sheet, where the browser has one. */
  share?: (info: ShareInfo) => Promise<void>;
  /** Copying text, where the browser lets the page. */
  copy?: (text: string) => Promise<void>;
  /** A finger rather than a mouse: a phone or a tablet. */
  coarse: boolean;
}

export function browserEnv(): ShareEnv {
  return {
    share: typeof navigator.share === "function" ? (info) => navigator.share(info) : undefined,
    copy: navigator.clipboard ? (text) => navigator.clipboard.writeText(text) : undefined,
    coarse: typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches,
  };
}

/** Whether Share opens the share sheet here, rather than copying the link. */
export const usesSheet = (env: ShareEnv) => env.share !== undefined && env.coarse;

/**
 * Shared through the sheet, the sheet closed without sharing (nothing to say), the link copied,
 * or neither worked (say the link, so it can still be copied by hand).
 */
export type ShareOutcome = "shared" | "closed" | "copied" | "failed";

/**
 * Hands the link on. Called straight from the click, so the sheet opens before anything is awaited:
 * browsers only open it while the tap still counts. A sheet that fails for any reason but the
 * person closing it falls back to copying.
 */
export async function shareLink(info: ShareInfo, env: ShareEnv): Promise<ShareOutcome> {
  if (usesSheet(env)) {
    try {
      await env.share!(info);
      return "shared";
    } catch (err) {
      if ((err as { name?: unknown } | null)?.name === "AbortError") return "closed";
    }
  }
  if (!env.copy) return "failed";
  try {
    await env.copy(info.url);
    return "copied";
  } catch {
    return "failed";
  }
}
