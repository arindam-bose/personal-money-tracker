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

/**
 * The amounts a search for this text finds, lowest and highest in cents, or null if it isn't an amount.
 * Like the digits read on a receipt, it matches as far as it was typed: "45" -> 45.00–45.99, "45.6" -> 45.60–45.69, "45.67" -> just 45.67.
 */
export function amountRange(text: string): [Cents, Cents] | null {
  const low = parseCents(text);
  if (low === null) return null;
  const decimals = text.split(".")[1]?.trim().length ?? 0;
  return [low, low + (decimals === 0 ? 99 : decimals === 1 ? 9 : 0)];
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
