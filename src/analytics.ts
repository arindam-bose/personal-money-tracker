// Google Analytics: page visits, counted, with consent.
//
// Nothing of Google's loads until the visitor says yes. Until then a banner asks (App draws it
// from `consentAsked`); the answer is kept in this browser, and Cookie settings in the About card
// brings the banner back to change it. Declining after accepting switches GA off for the rest
// of the visit and deletes its cookies.
//
// What you log never reaches it: the ledger lives in IndexedDB, which this does not read.
// In development nothing loads either way, so local work is never counted.

import { signal } from "@preact/signals";

export type Consent = "granted" | "denied";

const ID = "G-L8GJLNDBHJ";
/** Named for this app: other tools share the site's storage. */
const KEY = "money-tracker-analytics-consent";

function savedConsent(): Consent | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === "granted" || v === "denied" ? v : null;
  } catch {
    return null;
  }
}

/** The visitor's answer; null until they give one. */
export const consent = signal<Consent | null>(savedConsent());
/** Whether the banner is showing: until the first answer, and again when Cookie settings is opened. */
export const consentAsked = signal(consent.value === null);

/** What gtag.js reads off window: its queue, and the per-property off switch. */
type GaWindow = { dataLayer?: unknown[]; gtag?: (...args: unknown[]) => void; [off: string]: unknown };

let loaded = false;
function load(): void {
  if (!import.meta.env.PROD) return;
  const w = window as unknown as GaWindow;
  const wasOff = w[`ga-disable-${ID}`] === true;
  w[`ga-disable-${ID}`] = false;
  if (loaded) {
    // Said yes again after a no in the same visit: count this page, as a first yes would.
    if (wasOff) w.gtag!("config", ID);
    return;
  }
  loaded = true;
  w.dataLayer = w.dataLayer || [];
  // gtag.js reads the arguments object itself, not an array, so this can't be a rest parameter.
  w.gtag = function gtag() { w.dataLayer!.push(arguments); };
  w.gtag("js", new Date());
  w.gtag("config", ID);
  const script = document.createElement("script");
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${ID}`;
  document.head.append(script);
}

/** Switch GA off and delete its cookies. They're set on the widest domain GA can, so each goes on every parent of this host. */
function forget(): void {
  (window as unknown as GaWindow)[`ga-disable-${ID}`] = true;
  const names = document.cookie.split(";").map((c) => c.split("=")[0]!.trim())
    .filter((n) => n === "_ga" || n.startsWith("_ga_"));
  const parts = location.hostname.split(".");
  for (const name of names) {
    for (let i = 0; i < parts.length; i++) {
      document.cookie = `${name}=; Max-Age=0; path=/; domain=${parts.slice(i).join(".")}`;
    }
    document.cookie = `${name}=; Max-Age=0; path=/`;
  }
}

export function chooseConsent(value: Consent): void {
  consent.value = value;
  consentAsked.value = false;
  try {
    localStorage.setItem(KEY, value);
  } catch {
    // Not kept; the answer still holds for this visit.
  }
  if (value === "granted") load();
  else forget();
}

/** Bring the banner back, to change the answer. */
export function openConsent(): void {
  consentAsked.value = true;
}

if (consent.value === "granted") load();
