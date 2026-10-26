// The demo file people can download from the Settings page and import, to look around
// before entering their own money. It is built from the standard setup (blankSetup), so it
// always matches the app's current structure; tests/demo.test.ts checks it imports cleanly.
//
// A household of two, Jane and John, through a year: every month their paychecks, rent,
// groceries, bills, gas and a little cash; savings, IRA and brokerage contributions, a car loan
// payment and paying off last month's card. Around those, one-offs and seasons: a gift and a
// returned jacket in January, a dentist in March, a tax refund and card points in April, returned
// shoes in June, a July vacation partly from savings, concert tickets a friend paid back, holiday
// gifts and a December donation.
//
// Every account type shows up, and so do the ways an account can end: an old credit-union savings
// account is emptied and closed in March, a motorcycle (an asset) is sold and closed in April, and
// an old store card is only archived, still open. The investments and the car get value updates
// through the year.
//
// For the current year the demo stops at today, like real data would; a past year has all twelve
// months and a future one only January.

import { localToday } from "./derive";
import { DEFAULT_MEMBER } from "./members";
import { emptyYearFile } from "./rollover";
import { blankSetup } from "./setup";
import type { Account, Earning, Expense, IsoDate, Transfer, YearFile } from "./types";

/** One entry before it gets its id: the demo builds them month by month, then numbers them by date. */
type Draft<T> = Omit<T, "id">;

export function demoYear(year: number, now = new Date()): YearFile {
  const today = localToday(now);
  const thisYear = Number(today.slice(0, 4));
  // The last day the demo has entries for.
  const until = year < thisYear ? `${year}-12-31` : year === thisYear ? today : `${year}-01-31`;
  const on = (month: number, day: number): IsoDate => `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const lastMonth = Number(until.slice(5, 7));

  const expenses: Draft<Expense>[] = [];
  const earnings: Draft<Earning>[] = [];
  const transfers: Draft<Transfer>[] = [];
  const spend = (date: IsoDate, item: string, amount: number, account: string, cat: string, more: Partial<Expense> = {}) =>
    expenses.push({ date, item, amount, account, cat, tags: [], notes: "", ...more });
  const earn = (date: IsoDate, item: string, amount: number, account: string, cat: string, more: Partial<Earning> = {}) =>
    earnings.push({ date, item, amount, account, cat, notes: "", ...more });
  const move = (date: IsoDate, item: string, amount: number, from: string, to: string, cat: string, more: Partial<Transfer> = {}) =>
    transfers.push({ date, item, amount, from, to, cat, notes: "", ...more });
  const john = { member: "m_john" };
  const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

  for (let m = 1; m <= lastMonth; m++) {
    const month = MONTHS[m - 1]!;
    // Pay and the bills that come every month.
    earn(on(m, 2), "Paycheck - Acme Corp", 320000, "a_checking", "ci_paycheck");
    earn(on(m, 9), "Paycheck - City Hospital", 285000, "a_checking", "ci_paycheck", john);
    spend(on(m, 1), `${month} rent`, 220000, "a_checking", "ce_housing");
    spend(on(m, 5), "Internet", 6500, "a_card", "ce_bills");
    // Electricity peaks in winter and summer.
    spend(on(m, 12), "Electric bill", [14500, 13200, 10400, 8800, 9200, 12600, 15800, 16100, 11900, 9000, 10800, 13900][m - 1]!, "a_checking", "ce_bills");
    spend(on(m, 18), "Gas", 5200 + (m % 3) * 450, "a_card", "ce_transport", john);
    spend(on(m, 21), "Coffee and bagels", 1250, "a_wallet", "ce_food-drinks");
    spend(on(m, 15), "Farmers market", 3800 + (m % 4) * 300, "a_wallet", "ce_food-drinks");
    spend(on(m, 18), "Food bank donation", m === 12 ? 25000 : 5000, "a_checking", "ce_charity", m === 12 ? { notes: "Year-end gift" } : {});
    for (const [w, day] of [6, 13, 20, 27].entries()) {
      spend(on(m, day), "Weekly groceries", 11800 + ((m * 137 + w * 311) % 4200), "a_card", "ce_food-drinks", { tags: ["t_groceries"] });
    }
    if (m % 2 === 1) spend(on(m, 11), "Dinner out", 7400 + m * 90, "a_card", "ce_food-drinks", { tags: ["t_date-night"] });

    // Money moved between their own accounts.
    move(on(m, 3), "Move to savings", 100000, "a_checking", "a_savings", "ct_savings");
    move(on(m, 5), "Roth IRA contribution", 58300, "a_checking", "a_ira", "ct_investment-ira");
    move(on(m, 10), "ATM withdrawal", 10000, "a_checking", "a_wallet", "ct_cash-withdraw");
    move(on(m, 14), "Car loan payment", 45000, "a_checking", "a_car-loan", "ct_loan-payments");
    move(on(m, 28), "Index fund purchase", 25000, "a_savings", "a_brokerage", "ct_investment-stocks-cryptos", john);
    earn(on(m, 28), "Savings interest", 1700 + m * 35, "a_savings", "ci_interest");
  }

  // One-offs and seasons.
  earn(on(1, 20), "Birthday gift from Grandma", 10000, "a_wallet", "ci_other", { notes: "A one-off: left out of net earnings" });
  spend(on(1, 12), "Winter jacket", 8999, "a_card", "ce_shopping", { ...john, notes: "Returned on the 15th" });
  earn(on(1, 15), "Refund - winter jacket", 8999, "a_card", "ci_refunds", { ...john, offsets: "ce_shopping" });
  spend(on(3, 9), "Dentist", 15000, "a_card", "ce_health-wellness", john);
  // The old credit-union savings: emptied into High-Yield Savings, then closed (below).
  move(on(3, 30), "Move to High-Yield Savings", 150000, "a_old-savings", "a_savings", "ct_general-transfer", { notes: "Closing the old account" });
  // The motorcycle is sold on April 12 (and closed that day); the money is a one-off, not pay.
  earn(on(4, 12), "Sold the motorcycle", 420000, "a_checking", "ci_other", { notes: "Left out of net earnings" });
  earn(on(4, 18), "Federal tax refund", 64000, "a_checking", "ci_tax-refund");
  earn(on(4, 22), "Redeemed card points", 2500, "a_card", "ci_redeemed-cc-points", { offsets: null });
  spend(on(6, 7), "Running shoes", 12000, "a_card", "ce_shopping", { notes: "Too small: returned" });
  earn(on(6, 14), "Refund - running shoes", 12000, "a_card", "ci_refunds", { offsets: "ce_shopping" });
  move(on(7, 1), "For the vacation", 80000, "a_savings", "a_checking", "ct_savings-takeout");
  spend(on(7, 2), "Flights to Lisbon", 62000, "a_card", "ce_transport", { tags: ["t_vacation"] });
  spend(on(7, 16), "Hotel in Lisbon", 48000, "a_card", "ce_housing", { tags: ["t_vacation"] });
  spend(on(7, 18), "Dinners in Lisbon", 21500, "a_card", "ce_food-drinks", { tags: ["t_vacation"] });
  spend(on(8, 8), "Concert tickets for four", 18000, "a_card", "ce_personal-care-activities");
  earn(on(8, 12), "Sam paid back two tickets", 9000, "a_checking", "ci_paid-back", { offsets: "ce_personal-care-activities" });
  spend(on(11, 27), "Holiday gifts", 30000, "a_card", "ce_shopping", { tags: ["t_holidays"] });
  spend(on(12, 12), "Holiday gifts", 25000, "a_card", "ce_shopping", { tags: ["t_holidays"] });

  // Paying the card on the 25th: in January, what it owed on the 1st; after that, last month's charges.
  for (let m = 1; m <= lastMonth; m++) {
    const prev = m === 1 ? null : on(m - 1, 1).slice(0, 7);
    const charged = prev === null ? 45000
      : expenses.filter((e) => e.account === "a_card" && e.date.startsWith(prev)).reduce((s, e) => s + e.amount, 0)
        - earnings.filter((e) => e.account === "a_card" && e.date.startsWith(prev)).reduce((s, e) => s + e.amount, 0);
    if (charged > 0) move(on(m, 25), "Pay Rewards Card", charged, "a_checking", "a_card", "ct_payment-to-cc", { notes: m === 1 ? "Last year's statement" : "Last month's statement" });
  }

  // What the investments and the car were worth, as Jane read them now and then.
  const values = (list: [IsoDate, number][]) => list.filter(([date]) => date <= until).map(([date, amount]) => ({ date, amount }));
  const withValues = (a: Account, list: [IsoDate, number][]): Account => {
    const valuations = values(list);
    return valuations.length ? { ...a, valuations } : a;
  };
  const closedBy = (a: Account, day: IsoDate): Account => (day <= until ? { ...a, closedOn: day } : a);

  const accounts: Account[] = [
    { id: "a_checking", name: "Everyday Checking", type: "checking", ref: "**1234", opening: 320000 },
    { id: "a_savings", name: "High-Yield Savings", type: "savings", ref: "**5678", opening: 1250000 },
    closedBy({ id: "a_old-savings", name: "Credit Union Savings", type: "savings", ref: "**0042", opening: 150000 }, on(3, 31)),
    // A card that owes money opens negative.
    { id: "a_card", name: "Rewards Card", type: "credit", ref: "**4321", opening: -45000, limit: 500000 },
    // Still open (it keeps its limit), just not used: archived, not closed.
    { id: "a_store-card", name: "Store Card", type: "credit", ref: "**8800", opening: 0, limit: 100000, archived: true },
    { id: "a_wallet", name: "Wallet", type: "cash", ref: "", opening: 6000 },
    withValues({ id: "a_ira", name: "Roth IRA", type: "investment", ref: "**9012", opening: 0 },
      [[on(1, 1), 2150000], [on(6, 30), 2560000], [on(12, 31), 2980000]]),
    withValues({ id: "a_brokerage", name: "Brokerage", type: "investment", ref: "**3456", opening: 0 },
      [[on(1, 1), 800000], [on(3, 31), 905000], [on(6, 30), 1010000], [on(9, 30), 1082000], [on(12, 31), 1195000]]),
    // Taken out last August, so it opens at what was still owed on January 1.
    { id: "a_car-loan", name: "Car Loan", type: "loan", ref: "**7788", opening: -2180000, loanStart: `${year - 1}-08-14`, loanAmount: 2400000, rate: 6.9 },
    withValues({ id: "a_car", name: "Car", type: "asset", ref: "", opening: 0 }, [[on(1, 1), 2150000], [on(7, 1), 1980000]]),
    closedBy(withValues({ id: "a_motorcycle", name: "Motorcycle", type: "asset", ref: "", opening: 0 }, [[on(1, 1), 450000]]), on(4, 12)),
  ];

  // Only what happened by the last day, numbered in date order (ids made later sort later).
  const number = <T extends { date: IsoDate }>(list: Draft<T>[], prefix: string): T[] =>
    list.filter((e) => e.date <= until).sort((a, b) => a.date.localeCompare(b.date))
      .map((e, i) => ({ ...e, id: `${prefix}${String(i + 1).padStart(4, "0")}` }) as unknown as T);

  return {
    ...emptyYearFile({
      ...blankSetup(year),
      accounts,
      tags: [
        { id: "t_date-night", name: "Date night" },
        { id: "t_groceries", name: "Groceries" },
        { id: "t_holidays", name: "Holidays" },
        { id: "t_vacation", name: "Vacation" },
      ],
      members: [{ id: DEFAULT_MEMBER.id, name: "Jane" }, { id: "m_john", name: "John" }],
      budgets: {
        default: { "ce_food-drinks": 85000, ce_housing: 220000, ce_shopping: 20000, ce_transport: 15000, ce_bills: 22000 },
        // July is the vacation, and December's shopping target is higher, for the holidays.
        [`${year}-07`]: { "ce_food-drinks": 110000, ce_housing: 270000, ce_transport: 80000 },
        [`${year}-12`]: { ce_shopping: 50000 },
      },
    }, now),
    expenses: number(expenses, "e"),
    earnings: number(earnings, "i"),
    transfers: number(transfers, "x"),
  };
}

/** The name the demo downloads as. */
export const demoFileName = (year: number) => `money-tracker-demo-${year}.json`;
