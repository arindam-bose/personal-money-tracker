// The demo file people can download from the Settings page and import, to look around
// before entering their own money. It is built from the standard setup (blankSetup), so it
// always matches the app's current structure; tests/demo.test.ts checks it imports cleanly.
//
// A household of two, one January: paychecks, interest, a refund that lowers spending and
// a one-off gift; rent, groceries, a date night, a jacket, charity and coffee in cash; and
// transfers to savings, an IRA, a brokerage, the wallet and the credit card.

import { emptyYearFile } from "./rollover";
import { blankSetup } from "./setup";
import type { Earning, Expense, Transfer, YearFile } from "./types";

export function demoYear(year: number, now = new Date()): YearFile {
  const d = (day: string) => `${year}-01-${day}`;
  const setup = blankSetup(year);
  const expenses: Expense[] = [
    { id: "e0001", date: d("01"), item: "January rent", amount: 180000, account: "a_checking", cat: "ce_housing", tags: [], notes: "" },
    { id: "e0002", date: d("06"), item: "Weekly groceries", amount: 13467, account: "a_card", cat: "ce_food-drinks", tags: ["t_groceries"], notes: "" },
    { id: "e0003", date: d("11"), item: "Dinner at Luigi's", amount: 7850, account: "a_card", cat: "ce_food-drinks", tags: ["t_date-night"], notes: "Anniversary" },
    { id: "e0004", date: d("12"), item: "Winter jacket", amount: 8999, account: "a_card", cat: "ce_shopping", tags: [], notes: "Returned on the 15th", member: "m_sam" },
    { id: "e0005", date: d("18"), item: "Food bank donation", amount: 5000, account: "a_checking", cat: "ce_charity", tags: [], notes: "" },
    { id: "e0006", date: d("21"), item: "Coffee and bagels", amount: 1250, account: "a_wallet", cat: "ce_food-drinks", tags: [], notes: "" },
  ];
  const earnings: Earning[] = [
    { id: "i0001", date: d("02"), item: "Paycheck - Acme Corp", amount: 320000, account: "a_checking", cat: "ci_paycheck", notes: "" },
    { id: "i0002", date: d("09"), item: "Paycheck - City Hospital", amount: 285000, account: "a_checking", cat: "ci_paycheck", notes: "", member: "m_sam" },
    { id: "i0003", date: d("15"), item: "Refund - winter jacket", amount: 8999, account: "a_card", cat: "ci_refunds", notes: "", offsets: "ce_shopping", member: "m_sam" },
    { id: "i0004", date: d("20"), item: "Birthday gift from Grandma", amount: 10000, account: "a_wallet", cat: "ci_other", notes: "A one-off: left out of net earnings" },
    { id: "i0005", date: d("31"), item: "Savings interest", amount: 1842, account: "a_savings", cat: "ci_interest", notes: "" },
  ];
  const transfers: Transfer[] = [
    { id: "x0001", date: d("03"), item: "Move to savings", amount: 50000, from: "a_checking", to: "a_savings", cat: "ct_savings", notes: "" },
    { id: "x0002", date: d("05"), item: "Roth IRA contribution", amount: 58300, from: "a_checking", to: "a_ira", cat: "ct_investment-ira", notes: "" },
    { id: "x0003", date: d("10"), item: "ATM withdrawal", amount: 10000, from: "a_checking", to: "a_wallet", cat: "ct_cash-withdraw", notes: "" },
    { id: "x0004", date: d("25"), item: "Pay Rewards Card", amount: 45000, from: "a_checking", to: "a_card", cat: "ct_payment-to-cc", notes: "Last month's statement" },
    { id: "x0005", date: d("28"), item: "Index fund purchase", amount: 25000, from: "a_savings", to: "a_brokerage", cat: "ct_investment-stocks-cryptos", notes: "", member: "m_sam" },
  ];
  return {
    ...emptyYearFile({
      ...setup,
      accounts: [
        { id: "a_checking", name: "Everyday Checking", type: "checking", ref: "**1234", opening: 320000 },
        { id: "a_savings", name: "High-Yield Savings", type: "savings", ref: "**5678", opening: 1250000 },
        // A card that owes money opens negative.
        { id: "a_card", name: "Rewards Card", type: "credit", ref: "**4321", opening: -45000, limit: 500000 },
        { id: "a_wallet", name: "Wallet", type: "cash", ref: "", opening: 6000 },
        { id: "a_ira", name: "Roth IRA", type: "investment", ref: "**9012", opening: 0 },
        { id: "a_brokerage", name: "Brokerage", type: "investment", ref: "**3456", opening: 0 },
      ],
      tags: [
        { id: "t_date-night", name: "Date night" },
        { id: "t_groceries", name: "Groceries" },
      ],
      members: [{ id: "m_person-a", name: "Alex" }, { id: "m_sam", name: "Sam" }],
      budgets: {
        default: { "ce_food-drinks": 60000, ce_housing: 180000, ce_shopping: 20000, ce_transport: 15000 },
        // December's shopping target is higher, for the holidays.
        [`${year}-12`]: { ce_shopping: 50000 },
      },
    }, now),
    expenses,
    earnings,
    transfers,
  };
}

/** The name the demo downloads as. */
export const demoFileName = (year: number) => `money-tracker-demo-${year}.json`;
