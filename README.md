# Money Tracker

**Version 5.0.4**, released November 1, 2026 ·
[Use it online](https://arindambose.com/personal-money-tracker/) ·
[Release notes](https://github.com/arindam-bose/personal-money-tracker/releases)

Keep track of what you earn, spend, save and invest, one year at a time.

You type in your expenses, earnings and transfers yourself; the tracker works out
the rest: where your money went, how much you saved, what your cards owe, and how
you are doing against your monthly budgets.

## Your data stays with you

There is no account and no server. Everything you enter is stored in your own
browser, on your own computer, and is never sent anywhere.

If you say yes when the tracker first asks (or later, under **Cookie settings** in
Settings' About card), Google Analytics counts visits to the site. It never sees
what you log, and nothing of Google's loads unless you say yes.

That also means **you are the backup**. Download a copy of each year now and then
(the app reminds you a week after your last backup, if anything changed since). If
you clear your browser data or switch computers, import that file to get
everything back.

Once opened, the tracker keeps a copy of itself in your browser, so it works without
a signal too. New versions download by themselves; the top bar then offers
**Reload**.

## Getting started

1. Open the **Settings** page.
2. Either **import** a Money Tracker file (`.json`), or **start the year from
   scratch**: you get a standard set of categories, then add your bank accounts,
   cards, cash and loans on the **Accounts** page.
   Starting partway through the year? Pick the day you start: enter what each
   account held that morning, and the ledger begins there.
3. Log what happens on the **Ledger** page.

Want to look around first? On the **Settings** page, **Download a demo file** and
import it: a household of two with this year so far, with every kind of account and
entry, a loan, investments and a car, and accounts that were closed.

## What's in it

- **Dashboard**: the month or year at a glance: what you have after card debt,
  earned, spent, surplus, savings, investment and card payments, spending and
  earnings by category, budgets, account balances and how much of your card
  limits you're using. **Pin a total** adds a tile for a spending category or a
  tag; × takes it off.
- **Ledger**: every earning, expense and transfer in one list, 100 at a time,
  newest or oldest first. Filter by month, the last 1 to 12 months, or dates you
  pick, and by kind, account, category, tag or person; every filter list can be
  searched by typing. The search box finds words in the item or notes, or an
  amount by its first digits: 197 finds $197.00 and $1,972.25. Quick keyboard entry; **Today** by the date (or T in it) sets today's date. "Last updated" shows when an entry
  last changed, and backups carry it.
  Transfers (paying a card, moving money to savings) are shown apart, because
  they aren't spending.
- **Budget**: a monthly target for each spending category, with what's left.
- **Reports**: balances over time, where the money went, monthly cash flow
  (surplus months green, deficit months red), earning and expense reports by
  category and by week, what each credit card paid for, and savings and
  investment month by month.
  On Reports and Accounts, hover (or tab to) the **?** in a card's top right corner to see
  what it shows.
- **Accounts**: your accounts, categories and tags. Tick **Net** on the earning
  categories that make up net earnings. Earnings in **Lowers spending**
  categories (refunds, points, money paid back) lower net spending instead.
  **Transfer from external** is for money from your own accounts outside the
  tracker: it counts in Earned, but never in net earnings. Money sent out of the
  tracker is spending like any other.
  Deleting a category moves its entries to **Uncategorized**; deleting a tag takes
  it off its expenses.
  On an investment account, **Update balance** notes what it's worth today; it
  counts at that amount in net worth until you update it again.
  An **Asset** account (a house, a car) has no entries: **Update value** sets
  what it's worth, which counts in net worth and carries into the next year.
  **Close…** an account on the day you sold, paid off or shut it: from then it's
  left out of net worth and the next year. To keep an account that's still open
  out of the way, **Hide** it instead: new entries stop offering it, but it still
  counts in net worth and carries into the next year. These forms' dates have
  **Today** too, and T in them.
  A **Loan / mortgage** account takes the day it began, the amount borrowed and
  the interest rate. Interest is added monthly on what's still owed, each payment
  is a transfer into the loan (in **Loan Payments**), and what it owes comes off
  net worth. Untick **Include loans** on the dashboard or the Balances over time chart to see them without it.
- **Over the years**: once two or more years are stored, each Dashboard figure
  for every year side by side, with a table and the change from the year
  before. It's always everyone together; the year still under way is marked *.
  **Pin a total** adds a chart of a spending category's or a tag's spending each
  year, like the Dashboard's pinned tiles; × takes it off. Pins go into your backups.
- **A household**: everything belongs to **Person A** until you add someone on
  the Accounts page. Then each entry can be logged for one person, and the
  Dashboard, Ledger and Reports can show **All people** or one person at a time.
  Accounts and budgets stay shared by everyone.
  **Duplicate** an account (⧉, at the left of its row when you point at it) to start a similar one (the copy is named "… (new)").
- **Settings**: import a year, or start one from scratch (from January 1 or any
  later day); back up, and close a finished year, which starts the next one from
  its closing balances. Also each year's IRA limit; **Delete…** to remove one
  year (import its backup to bring it back); **Erase everything**; **Appearance**
  (light, dark, or as your device); whether the tracker is ready to use offline,
  with **Check for updates**; **On your home screen**, to install it as an app
  (an **Install** button where the browser offers one, and that browser's own
  steps where it doesn't); a demo file to try; and **About**.

## Handy keys on the Ledger

| Key | Does |
|---|---|
| <kbd>I</kbd> / <kbd>E</kbd> / <kbd>T</kbd> | Add an earning, expense or transfer |
| <kbd>/</kbd> | Search |
| <kbd>Enter</kbd> | Save the form, or edit the selected row |
| <kbd>Esc</kbd> | Close the form |
| <kbd>D</kbd> | Duplicate the selected row (the copy's name ends in "(new)") |

---

For how it's built, and how to run, test or change it, see the
[extended README](EXTENDED_README.md).
