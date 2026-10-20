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
