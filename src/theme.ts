// Light or dark. The choice is "system" (follow the device), "light" or "dark", kept in this
// browser only: it belongs to the device, not the data, so backups leave it out.
// The page shows it as data-theme="light" | "dark" on <html>; style.css keys the dark
// colours off that. index.html sets it before the first paint, so there is no flash.

import { signal } from "@preact/signals";

export type ThemeChoice = "system" | "light" | "dark";
export type Theme = "light" | "dark";

/** Shared with the inline script in index.html. Named for this app: other tools share the site's storage. */
const KEY = "money-tracker-theme";

const darkQuery = matchMedia("(prefers-color-scheme: dark)");

function savedChoice(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

function resolve(choice: ThemeChoice): Theme {
  return choice === "system" ? (darkQuery.matches ? "dark" : "light") : choice;
}

export const themeChoice = signal<ThemeChoice>(savedChoice());

/** The theme on screen. Charts read it, so they redraw in the new colours on a switch. */
export const theme = signal<Theme>(resolve(themeChoice.value));

function apply(): void {
  theme.value = resolve(themeChoice.value);
  document.documentElement.dataset.theme = theme.value;
}

export function setTheme(choice: ThemeChoice): void {
  themeChoice.value = choice;
  try {
    if (choice === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, choice);
  } catch {
    // Not kept; the choice still applies until the page reloads.
  }
  apply();
}

// Following the device: switch when it does.
darkQuery.addEventListener("change", apply);
apply();
