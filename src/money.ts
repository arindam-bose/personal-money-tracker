import type { Cents } from "./types";

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

/** 1234 -> "$12.34", -1234 -> "-$12.34". */
export function formatCents(amount: Cents): string {
  return usd.format(amount / 100);
}

/**
 * Parse what a user types into an amount field: "12.34", "$1,234.5", "7".
 * Returns null if it isn't a valid non-negative amount with at most 2 decimals.
 * Works on the digits as text, so it never picks up float errors.
 */
export function parseCents(text: string): Cents | null {
  const s = text.replace(/[$,\s]/g, "");
  const m = /^(\d+)(?:\.(\d{0,2}))?$/.exec(s);
  if (!m) return null;
  const dollars = Number(m[1]);
  const cents = Number((m[2] ?? "").padEnd(2, "0"));
  return dollars * 100 + cents;
}

/** Amount as it's typed in a form: 1234 -> "12.34", 197225 -> "1972.25". */
export function amountText(cents: Cents): string {
  return formatCents(cents).replace(/[$,]/g, "");
}

/**
 * What an amount search looks for at the start of amountText, or null if the text isn't an amount.
 * "$1,97" -> "197", which finds 197.00 and 1972.25, but not 150.00 for "50". Leading zeros go,
 * as amountText has none: "05" -> "5", "0.5" stays.
 */
export function amountPrefix(text: string): string | null {
  return parseCents(text) === null ? null : text.replace(/[$,\s]/g, "").replace(/^0+(?=\d)/, "");
}

const compact = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 });

/** Short form for axes and tight spaces: 123456 -> "$1.2K", 250000000 -> "$2.5M". */
export function formatCompact(amount: Cents): string {
  return compact.format(amount / 100);
}

/** A fraction as a percentage, always 2 decimals: 0.1234 -> "12.34%". Null (no meaningful ratio) shows as "–". */
export function formatPercent(fraction: number | null): string {
  return fraction === null ? "–" : `${(fraction * 100).toFixed(2)}%`;
}

/** Like parseCents, but allows a leading minus, e.g. an overdrawn account: "-12.50" -> -1250. */
export function parseSignedCents(text: string): Cents | null {
  const t = text.trim();
  const negative = t.startsWith("-") || t.startsWith("−");
  const cents = parseCents(negative ? t.slice(1) : t);
  return cents === null ? null : negative ? -cents : cents;
}
