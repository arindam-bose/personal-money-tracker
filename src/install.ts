// Putting the tracker on the home screen. The same approach as the RDR2 Crafting Guide's install.js.
//
// The manifest and the service worker make it installable; this is for saying so. Chrome, Edge
// and Samsung's browser fire `beforeinstallprompt` once they consider the page installable, and
// the event can be kept and its prompt shown later, from a button, so Settings can offer a real
// Install. Firefox and Safari have no such event: there, all a page can do is say where the
// browser keeps its own Add to Home Screen, in the words that browser uses.
//
// Imported at startup (main.tsx), so the listener is in place before the event fires, whichever
// page the visit opens on. The event is kept, not cancelled: cancelling it would also hide the
// browser's own offer, and that is worth keeping for anyone who never opens Settings.

import { signal } from "@preact/signals";
import type { Device } from "./device";

/** What Chrome hands over: not in TypeScript's DOM types, since it's Chromium's alone. */
interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

/**
 * "running" when this is the installed app itself, "installed" when it was installed during
 * this visit (this tab is still the browser), "prompt" when the browser's own install prompt
 * can be shown, and "manual" otherwise.
 */
export type InstallState = "running" | "installed" | "prompt" | "manual";

let deferred: InstallPromptEvent | null = null;

/** Opened from the home screen. `navigator.standalone` is Safari's own word for it. */
function running(): boolean {
  return matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

export const installState = signal<InstallState>(typeof window === "undefined" ? "manual" : running() ? "running" : "manual");

if (typeof window !== "undefined") {
  addEventListener("beforeinstallprompt", (event) => {
    deferred = event as InstallPromptEvent;
    if (installState.value === "manual") installState.value = "prompt";
  });
  addEventListener("appinstalled", () => {
    deferred = null;
    installState.value = "installed";
  });
}

/**
 * Show the browser's install prompt: "accepted", "dismissed", or "unavailable" if there is none
 * or the browser refused to show it. An event's prompt can be shown once, so it is spent either
 * way; if the visitor says no, Chrome may fire a fresh one later.
 */
export async function promptInstall(): Promise<"accepted" | "dismissed" | "unavailable"> {
  const event = deferred;
  if (!event) return "unavailable";
  deferred = null;
  try {
    await event.prompt();
    const { outcome } = await event.userChoice;
    // Said yes: installed, as far as this tab need know, without waiting on `appinstalled`,
    // which can come seconds later.
    installState.value = outcome === "accepted" ? "installed" : "manual";
    return outcome;
  } catch {
    installState.value = "manual";
    return "unavailable";
  }
}

/** A step of the instructions: plain text, or the name of a button or menu item, shown in bold. */
export type Step = string | { b: string };

/** Where this browser keeps Add to Home Screen, in the words that browser uses. */
export function installSteps({ browser, system }: Device): Step[] {
  if (system === "iPhone" || system === "iPad") {
    return browser === "Safari" || !browser
      ? ["Tap Safari's ", { b: "Share" }, " button, then ", { b: "Add to Home Screen" }, "."]
      : [`Open ${browser}'s `, { b: "Share" }, " menu, then choose ", { b: "Add to Home Screen" }, "."];
  }

  if (system === "Android") {
    if (browser === "Chrome") return ["Open Chrome's three-dot menu and choose ", { b: "Add to Home screen" }, ", then ", { b: "Install" }, "."];
    if (browser === "Firefox") {
      return ["Open Firefox's three-dot menu and choose ", { b: "Add to Home screen" }, " (", { b: "Install" }, " on some versions)."];
    }
    if (browser === "Samsung Internet") return ["Open the menu, choose ", { b: "Add page to" }, ", then ", { b: "Home screen" }, "."];
    return ["Open the browser's menu and look for ", { b: "Add to Home screen" }, " or ", { b: "Install" }, "."];
  }

  if (browser === "Chrome" || browser === "Edge") {
    return ["Click the install icon at the right end of the address bar, or find ", { b: "Install" }, ` in ${browser}'s menu.`];
  }
  if (browser === "Safari" && system === "Mac") return ["In Safari's ", { b: "File" }, " menu, choose ", { b: "Add to Dock" }, "."];
  if (browser === "Firefox") {
    return ["Firefox on a computer can't install a site. Bookmark this page, or open it in Chrome or Edge and install it from there."];
  }
  return ["Look in the browser's menu for ", { b: "Install" }, " or ", { b: "Add to Home screen" }, "."];
}
