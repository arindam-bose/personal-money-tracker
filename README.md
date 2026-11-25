# Money Tracker

**Version 7.0.19** ·
[Use it online](https://arindambose.com/personal-money-tracker/)

Keep track of what you earn, spend, save and invest, one year at a time.

You type in your expenses, earnings and transfers; the tracker works out the rest:
where your money went, how much you saved, what your cards owe, and how you're
doing against your monthly budgets.

## Your data stays with you

- **No account, no server.** Everything you enter stays in your own browser and is never sent anywhere.
- **Analytics only if you agree.** Say yes when asked (or later, under **Cookie settings** in Settings' About card) and Google Analytics counts visits. It never sees what you log, and nothing of Google's loads otherwise.
- **You are the backup.**
  - **Backup** in the top bar downloads the open year (an icon on a phone). It turns red a week after your last backup, if anything changed since.
  - To restore, use **Import** beside it, or drop the file anywhere on the page. You're asked before a year you already have is replaced.
- **Works offline.** Once opened, the tracker keeps a copy of itself. New versions download by themselves; **Reload** in the top bar (or the Offline card in Settings) switches to them.

## Getting started

1. Open the **Settings** page.
2. Either **import** a Money Tracker file (`.json`), or **start the year from scratch**: you get a standard set of categories, then add your bank accounts, cards, cash and loans on the **Accounts** page.
   Starting partway through the year? Pick the day you start and enter what each account held that morning.
3. Log what happens on the **Ledger** page.

Want to look around first? In **Settings**, **Download a demo file** and import it: a household of two, with every kind of account and entry, a loan, investments, a car, subscriptions and closed accounts.

## What's in it

A thin strip under the top bar (except on Over the years) shows when the open year last changed. Backups carry that time too.

### Dashboard

- The month or year at a glance: net worth, earned, spent, surplus, savings, investment and card payments.
- Spending and earnings by category, budgets, account balances and how much of your card limits you're using.
- Click a category or an account to see its entries in the Ledger.
- **Pin a total** adds a tile for a spending category or a tag; × takes it off.

### Ledger

- Every earning, expense and transfer in one list, 100 at a time, newest or oldest first.
- Filter by month, the last 1 to 12 months, or dates you pick, and by kind, account, category, tag or person. Every filter list can be searched by typing.
- Search finds words in the item or notes, or an amount by its first digits: 197 finds $197.00 and $1,972.25.
- Transfers (paying a card, moving money to savings) are shown apart, because they aren't spending.
- Quick keyboard entry (see [Handy keys](#handy-keys-on-the-ledger)); **Today**, or T, in a date sets today.

### Budget

- A monthly target for each spending category, with what's left.

### Reports

- **Balances over time**, **where the money went**, and **monthly cash flow** (surplus months green, deficit months red).
- **Earning and expense reports**: by category and by week.
- **Subscriptions**: expenses tagged **Subscription**, with how many are active, what they cost this year and what a year of them costs. Give a subscription the same name every time, across years.
- **Credit card usage**: what each card paid for.
- **Savings and investment**, month by month.
- Hover (or tab to) the **?** in a card's corner to see what it shows. Accounts has these too.

### Accounts

- Your accounts, categories, tags and people.
- **Earning categories**:
  - Tick **Net** on the ones that make up net earnings.
  - **Lowers spending** ones (refunds, points, money paid back) lower net spending instead.
  - **Transfer from external** is money from your own accounts outside the tracker: it counts in Earned, never in net earnings. Money sent out is spending like any other.
- Deleting a category moves its entries to **Uncategorized**; deleting a tag takes it off its expenses.
- **Investment** accounts: **Update balance** notes what it's worth; that counts in net worth until the next update.
- **Asset** accounts (a house, a car) have no entries: **Update value** sets what it's worth, in net worth and into the next year.
- **Loan / mortgage** accounts take the start day, amount borrowed and interest rate. Interest is added monthly; each payment is a transfer into the loan (in **Loan Payments**); what it owes comes off net worth. Switch off **Include loans** (Dashboard, Balances over time) to see net worth without them.
- **Close…** an account on the day you sold, paid off or shut it: from then it's out of net worth and the next year. **Hide** keeps an open account out of the way: new entries stop offering it, but it still counts.
- **Duplicate** (⧉, at the left of a row when you point at it) starts a similar account, named "… (new)".

### Over the years

- Once two or more years are stored: each Dashboard figure for every year side by side, with a table and the change from the year before.
- **Net worth** comes first: at the end of each past year, today for the one under way (marked *).
- Always everyone together.
- **Pin a total** charts a spending category or a tag each year; × takes it off. Pins go into your backups.

### A household

- Everything belongs to **Person A** until you add someone on the Accounts page.
- Then each entry can be logged for one person, and the Dashboard, Ledger and Reports can show **All people** or one person.
- Accounts and budgets stay shared.

### On a phone

- A round **+** at the bottom corner of every page opens **Add Transaction** (a new expense) and **Add Account**. Until the year has an account, it only offers Add Account.

### Settings

- **Import** a year (one you already have shows both sets of counts side by side, differences highlighted, before replacing it), or **start** one from scratch, from January 1 or any later day.
- **Back up**, and **close** a finished year, which starts the next one from its closing balances.
- Each year's **IRA limit**; **Delete…** a year (import its backup to bring it back); **Erase everything**.
- **Appearance**: light, dark or as your device, and **Hide numbers**, which shows every amount as dots, for when someone can see the screen.
- **Offline**: whether it's ready to use offline, with **Check for updates**.
- **On your home screen**: install it as an app (an **Install** button where the browser offers one, its own steps where it doesn't).
- A **demo file** to try, **Support the tracker** (Buy me a coffee, or share the link), and **About**.

## Handy keys on the Ledger

| Key | Does |
|---|---|
| <kbd>I</kbd> / <kbd>E</kbd> / <kbd>T</kbd> | Add an earning, expense or transfer |
| <kbd>/</kbd> | Search |
| <kbd>Enter</kbd> | Save the form, or edit the selected row |
| <kbd>Esc</kbd> | Close the form, or clear the search (again to leave it) |
| <kbd>D</kbd> | Duplicate the selected row (the copy's name ends in "(new)") |

---

For how it's built, and how to run, test or change it, see the
[extended README](EXTENDED_README.md).
