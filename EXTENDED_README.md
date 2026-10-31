# Money Tracker: extended README

How the tracker is built and why: the stack, the data model, how every figure is
worked out, storage and backups, the Notion importer, and the tests. For what the
tracker is and how to use it, start with the [README](README.md).

A static site: Vite + Preact + TypeScript, built to plain files. All data lives in
the browser's IndexedDB; a JSON file per year is the backup. There is no server.

## Running it

Needs Node 22 (`nvm use` picks it up from `.nvmrc`).

```sh
npm install
npm run dev        # dev server with hot reload
npm test           # unit tests (Vitest)
npm run typecheck  # app and tests (two tsconfigs, see below)
npm run build      # typecheck, then the static site in dist/
npm run preview    # serve dist/ locally
```

`vite.config.ts` sets `base: "./"`, so `dist/` works from any sub-folder of a
website.

The app's version is `version` in `package.json`, shown in the header after the
name. It reads `vX.0.Y`: X is the major release, Y counts the updates in between.
Bump Y with every committed change, and keep `package-lock.json` in step. Set
`released` in `package.json` to that day ("YYYY-MM-DD") too: the About card on the
Settings page shows "Tool version vX.0.Y, updated <date>" from the two.

Versions: Preact is held on 10.x (11 was too new for `@preact/preset-vite` when
this started). TypeScript is strict, including `noUncheckedIndexedAccess`.

## Layout

| Path | What it holds |
|---|---|
| `src/types.ts` | The data model. Read this first. |
| `src/money.ts` | Parsing and formatting amounts (integer cents). |
| `src/validate.ts` | Checks an imported file before anything is stored. |
| `src/db.ts` | IndexedDB storage. |
| `src/backup.ts` | JSON import and export. |
| `src/demo.ts` | The demo file on the Settings page, built from the standard setup. |
| `src/year.ts` | When a year's tracking starts: its start date, or January 1. |
| `src/device.ts` | The browser and system, for backup file names. |
| `src/theme.ts` | Light or dark: the Settings choice, or following the device. |
| `src/views/about.tsx` | The About card: About and How to use dialogs, version, links to GitHub. |
| `src/offline.ts`, `src/service-worker.js` | The offline copy: registering it, its status, checking for updates. |
| `src/derive.ts` | Every computed figure. Plain functions, no UI. |
| `src/entries.ts` | Entry-form logic: drafts, checks, transfer-category suggestion, duplicating. |
| `src/setup.ts` | Editing accounts, categories, tags and members; a blank year's defaults; upgrading years saved with people. |
| `src/categories.ts` | The Uncategorized category of each kind (`uncategorizedId`, `withUncategorized`), apart so both `setup.ts` and `entries.ts` can use it without importing each other. |
| `src/members.ts` | The default member and `membersOf`, apart so `entries.ts` can use them without an import loop. |
| `src/rollover.ts` | What the next year starts with when a year is closed. |
| `src/state.ts` | The open year as Preact signals, and the actions that change it. |
| `src/views/` | One Preact view per page, plus `chart.tsx` (the ECharts wrapper), `people.tsx` (the person picker) and `search-select.tsx` (the dropdown with a search box, used for accounts, categories, tags and the ledger filters). |
| `tools/` | Python: Notion export to JSON (`notion_import.py`), and a checker (`verify.py`). |
| `tests/` | Vitest. `fixtures/` holds synthetic data only. |
| `data/` | Your real data and Notion exports. Git-ignored; never commit it. |

## Data model

One year is one `YearFile` (`src/types.ts`): accounts, categories, tags,
budgets, and three tables of entries: **expenses**, **earnings** and **transfers**.
Users only ever enter entries; accounts and categories are set up once a year.

The rules that everything else relies on:

- **Amounts are integer cents.** Never floats: Notion's float rollups showed
  values like `87546.30000000002`. `parseCents` parses typed text digit by digit.
- **Dates are `YYYY-MM-DD` strings**, and every entry's date is inside its year.
- **Everything refers to everything else by id.** Renaming an account or a
  category never touches an entry.
- **Balances use the net-worth sign.** A card or loan that owes money has a negative
  balance. For every account: `balance = opening + money in − money out`, and a
  loan also adds its interest (below). What an investment or asset is worth is
  separate: its latest value update, not its balance.
- **Nothing computed is stored.** Balances, totals and budget progress are worked
  out from the entries each time (a year is ~1,000 rows; this is fast).

### Investment balances

An investment account's balance in the ledger is only what was put in this year.
What it's worth comes from **Update balance** on the Accounts page, which notes
the balance on a day (today by default) in the account's `valuations`
(`saveValuation` and `deleteValuation` in `setup.ts`). There's at most one per
day, and a second one replaces the first. Between updates the account is worth
the last one, whatever moved in or out since (`valuationOf` in `derive.ts`).
Before its first update it isn't counted. Any investment account can have them,
retirement ones included. A new year starts without any, so the account is left
out of net worth until it's updated again. A copied account doesn't
take them, and tracking can't start after one.

### Assets

An `asset` account is something you own whose value seldom changes: a house, a
car. It has no opening balance and no entries can use it: its value only comes
from **Update value**, the same `valuations` investments have, and it's worth
the last one until the next. Adding an asset can take its value today as the
first update. Unlike an investment, it keeps its value into a new year: closing
a year carries the value on December 31 over, dated January 1. Moving the start
date later moves an asset's earlier value up to the new start day, instead of
refusing as it does for an investment. Imported files can't have an asset with
an opening balance, or an entry that uses one.

### Closing an account

**Close…** on the Accounts page closes an account on a day: sold, paid off, shut
(`closeAccount` in `setup.ts`; `closedOn` on the account). From that day it's left
out: an asset or investment is worth nothing (`valuationOf` returns none), a closed
card's limit stops counting, and the dashboard stops listing it (earlier months
still do). No entry or value update can come after that day, and the next year
doesn't have the account. A bank, cash, card or loan account must be at 0 at the
end of the day it closes, so its money isn't lost from net worth: move
it out with a transfer first. **Reopen** undoes it. Tracking can't start after a
closed account's day.

### Loans

A `loan` account (a loan or mortgage) also has `loanStart`, `loanAmount` and
`rate` (yearly, as a percentage). Its `opening` is what was owed the morning
tracking started; a loan taken out since then opens at 0, and its amount is
added on `loanStart`. On each monthly anniversary of `loanStart` (the 31st falls
on a shorter month's last day), `rate ÷ 12` of what's still owed is added,
rounded to the cent, before that day's entries. A payment is a transfer into
the loan; the entry form suggests the **Loan Payments** category (role
`loan_payment`), which a new year has and an older one gets with its first loan.
Loans take transfers only, not expenses or earnings.

All of this is in `loanStatus` (`derive.ts`). Without a `through` day, interest
runs to today, or to December 31 once the year is over. Moving the year's start
date moves each loan's opening with it (`withStart` in `setup.ts`).

### Roles

Categories carry a hidden **role**, so users can rename them and the reports still
know what each one means:

| Kind | Roles |
|---|---|
| Expense | none (regular), `charity`, `transfer_out` (to your own accounts outside the tracker: in Spent, not net spending) |
| Earning | `paycheck`, `income`, `offset` (refunds, points, money paid back: lowers spending), `transfer_in` (from your own accounts outside the tracker: in Earned, never net earnings) |
| Transfer | `cc_payment`, `savings_in`, `savings_out`, `invest_retirement`, `invest_taxable`, `cash_withdrawal`, `loan_payment`, `general` |

Earning and transfer categories must have a role; the validator refuses a file
without one. Earning categories with a `paycheck` or `income` role may also carry
`net: false` to leave them out of **net earnings** (for one-offs such as an
insurance payout). Left out, they count.

Loan payments used to be an expense role, `loan`. They are now transfers into a
loan account, in a `loan_payment` category; an older `loan` expense category
becomes regular spending when its file is imported or its year opened
(`withoutLegacyPeople` in `validate.ts`, `withoutPeople` in `setup.ts`). To keep
counting loan payments as spending, use an expense category and a pinned tag.

### Uncategorized

Each kind has an **Uncategorized** category (`ce_`/`ci_`/`ct_uncategorized`). It
can't be deleted. Deleting any other category moves its entries there, and a
refund aimed at a deleted expense category is re-aimed there too. The setup
change and the moved entries are written in one transaction (`deleteCategory`
in `setup.ts`, `removeCategory` in `state.ts`). The roles keep moved entries out
of the headline figures: the earning one is `income` with `net: false`, and the
transfer one is `general`. A new year starts with it, and an open year that
doesn't have it gets it when it's opened. New entries start in it too: `emptyDraft`
in `entries.ts` sets it (`defaultCategory`), and the entry form uses the same rule
when you switch kind or it clears for the next entry. It lives in `categories.ts`.

### Members (a household)

`members` on the year lists the household; left out, it's one default member,
"Person A" (`membersOf` in `members.ts`). The first member is the default: an entry
carries `member` only when it belongs to someone else, so a one-person year looks
exactly as before. Deleting a member drops `member` from their entries, which
gives them back to the default; the default can't be deleted.

A member's dashboard and reports use `forMember` (`derive.ts`): the ledger with
only their entries and every account. So their earned, spent, net figures,
savings and investing add up across members to the household's. Balances (net
worth, the Accounts card, Balances over time) and budgets are the
household's and only show under "All people". The picker (`views/people.tsx`)
and the Ledger's person filter appear once there are two members.

Not to be confused with the **people** of earlier versions, below.

### No people

Earlier versions tracked people: an expense could carry the share someone owed
back (`owed`), and a `reimbursement` earning named who paid it (`person`). That
was dropped to keep the figures simple: money paid back is now just an earning
that lowers net spending (see below). Older data is upgraded wherever it comes
in: `people`, `owed` and `person` are removed, and a `reimbursement` category
becomes `offset`. Imported files are cleaned before checking
(`withoutLegacyPeople` in `validate.ts`). Stored years are cleaned when opened
(`withoutPeople` in `setup.ts`): an open year is saved that way, a closed one
only in memory, and its backup leaves them out too.

## How the figures are worked out

All in `src/derive.ts`, checked against Notion's own totals for 2024–2026 (see
Tests).

| Figure | Formula |
|---|---|
| Earned | All earnings (Notion's gross view) |
| Spent | All expenses, split bank / card / cash by the debited account's type |
| Surplus | Earned − spent |
| Net earnings | Earnings in paycheck/income categories not marked `net: false` (the "Net" tick) |
| Net spending | Spent (Uncategorized included) − earnings in `offset` ("Lowers spending") categories (`spendingOffsetCategories`) − expenses in `transfer_out` categories |
| Net savings | `savings_in` − `savings_out` transfers |
| Investment | `invest_retirement` + `invest_taxable` transfers |
| Loan payments | `loan_payment` transfers (not spending) |
| Savings / investment / charity rate | As a share of paycheck income |
| Available cash | Checking + savings + cash balances |
| Card debt, utilization | −(card balances); debt ÷ total limits |
| Loans owed | −(loan balances), interest included |
| Investments worth | Each investment account's latest balance update; accounts without one aren't counted |
| Assets worth | Each asset account's latest value |
| Net worth | What you own minus what you owe: available cash + investments worth + assets worth − card debt − loans owed. The **Include loans** switch (Dashboard, and Balances over time in Reports) can leave loans out too |

Investment accounts' ledger balances are contributions this year, not market
value; they open at 0 every year. What they're worth is only what the user enters.

**Budgets** (`budgetView`): each expense category has a usual monthly target
(`budgets.default`) and optional one-month overrides (`budgets["2026-03"]`).
Spending against a budget is net of refunds aimed at that category (`offsets` on
the earning). Refunds aimed at no category lower the
total only, shown as their own line so the bottom line equals net spending. So do
`transfer_out` categories: their lines show what was sent, and a line of their own
takes it off the total.

**Money flow** (the Sankey, `moneyFlow`): earnings by category flow into one
"Income" hub, which flows out to spending categories, savings, investing and
loan payments.
Money taken out of savings, or drawn from balances when outflows beat income,
joins on the income side, so both sides always balance. Card payments and other
moves between your own accounts aren't shown.

## Storage

`src/db.ts`. One IndexedDB database, `money-tracker`, with five stores:

- `years`: one setup per year (accounts, categories, tags, members, budgets,
  the IRA limit if one is set, plus `closed` and `lastBackupAt`), keyed by year.
- `expenses`, `earnings`, `transfers`: one record per entry, keyed by
  `[year, id]`, because ids like `e0001` repeat every year.
- `settings`: app-wide values (pinned tags, the year last opened, whether the
  dashboard's net worth leaves loans out).

Replacing a year on import runs in one transaction: if anything fails, the old
data stays. The app calls `navigator.storage.persist()` on start so the browser
doesn't clear the data under storage pressure; the Settings page shows whether it
agreed and can ask again.

### Offline copy

`src/service-worker.js` is the service worker. It is plain JavaScript outside the
bundle: the `serviceWorker` plugin in `vite.config.ts` fills in the version and
the list of built files, and writes it as `dist/sw.js`. Built files carry content
hashes, so all of them are cached on install and served from the cache; only the
page itself goes to the network first. The cache is named
`money-tracker-v<version>`, and a new build makes a new `sw.js`, so every deploy
reaches people as an update: it downloads by itself, and the top bar offers
**Reload**. **Check for updates** on the Settings page asks for it straight away.
There is no service worker in development (`npm run dev`), so edits always show.

### Light and dark

`src/theme.ts` holds the choice from the Settings page: System (the default),
Light or Dark. It lives in `localStorage` under `money-tracker-theme`, on this
device only, so backups and Erase everything leave it alone. The page shows the
result as `data-theme="light" | "dark"` on `<html>`, and `style.css` swaps every
colour token under `:root[data-theme="dark"]`. A small inline script in
`index.html` sets it before the first paint, so there is no flash of the wrong
theme. Charts read the tokens and redraw when `theme` changes.

### State changes

`src/state.ts` holds the open year in a signal (`current`). Every change goes
through an action that writes to IndexedDB first, then updates the signal.
**Actions run one at a time** (`inTurn`), each reading the latest state when its
turn comes. Without that, two quick changes (typing budgets down a column, rapid
ledger saves) read the same old setup and the second overwrote the first;
`tests/state.test.ts` guards against it.

### Starting partway through a year

A year can start on any day: `start` in the year file (`src/year.ts`; left out, it
is January 1). Opening balances are what each account held on the morning of
that day, and no entry may be dated before it: the opening already includes
anything earlier, so it would count twice. The importer, the entry form and
`withStart` (moving the date on the Accounts page) all hold to that. Closing the
year starts the next one on January 1.

Budgets, the dashboard and reports count from the start month (`firstMonth`,
`monthShare` in `year.ts`; `budgetView` takes the start). Months before it have
no targets, and the start month's usual targets are scaled to the days covered:
from July 14 that is 18 of 31 days. A "This month only" target is used as entered,
since it was set for the part of the month there is. The pace tick in that month
counts from the start day. Reports begin at the start month, weekly charts at its
week, and the balances line at the opening balances.

IRA contributions made earlier that year aren't in the ledger, so the year can
hold them as `iraBeforeStart` (entered on the Settings page, under the IRA
limit). `remainingRetirement` counts them against the limit; they aren't carried
into the next year.

### Backups

A backup is the year's `YearFile`, downloaded from the Settings page or the top-bar
reminder (shown for an open year with entries that was never backed up, or that
changed since a backup at least 7 days old, in its entries or its setup; `backupDue` in `storage.ts`). Importing a
file counts as a backup made at its `exportedAt` time. JSON keys are written in a
fixed order, so two backups of the same year diff cleanly.
Backups are named `money-tracker-<year>_<date>_<time>_<browser>_<system>.json`
(`backupFileName` in `backup.ts`, `src/device.ts`), e.g.
`money-tracker-2026_2026-10-25_21-05-09_chrome_linux.json`: local time, to the
second, so backups from different days and devices sit side by side.

A backup holds everything needed to rebuild the year on a clean device:

- `lastChangedAt`, when an entry was last added, changed or deleted (the ledger's
  "Last updated"; stamped by `saveEntry`, `removeEntry` and setup changes that move
  entries, in `state.ts`). Of two backups of a year, the later one is newer; importing
  over a year shows both times and warns when the tracker's is later. Left out until
  the first change.
- `setupChangedAt`, when the setup last changed: accounts, categories, tags, people,
  budgets, the start day or IRA settings (`saveSetup` and `saveChange` in `state.ts`;
  bringing an older year up to date on opening doesn't count). Kept apart from
  `lastChangedAt` so the ledger's "Last updated" stays about entries; the backup reminder
  and the import warning look at both. Left out until the first change.
- `closed: true` for a closed year, so it comes back read-only (left out while open).
- `iraLimit`, the year's IRA limit: the one set on the Settings page, or else the IRS
  limit for that year. Every backup writes it; in older files without it, the IRS
  limit applies (`IRA_LIMITS` in `setup.ts`; years past the list use the
  latest one). Add the new limit there when the IRS announces it. A closed
  year's limit doesn't carry into the next year.
- `settings.pinnedTags`, the dashboard's pinned tags. They are app-wide, so
  importing applies them only when the device has none saved yet; restoring an
  old year never undoes today's pins.

All four are optional on import, so older backups still import. `tests/transfer.test.ts`
moves a year that uses every optional field to a clean device and back; its file
is typed `Required<YearFile>`, so a field added later must be added there too. What is left out on
purpose: `lastBackupAt` (an import counts as a backup at `exportedAt`), the year
last opened, and per-tab filters and periods.

### Closing a year

`closeYear` makes the year read-only and starts the next one
(`nextYearSetup` in `rollover.ts`): bank, cash, card and loan accounts open at their
closing balance on December 31 (a loan's interest included), investment accounts at 0 and without balance updates, assets with their last value dated January 1, closed accounts left behind; accounts, categories, tags and
usual budget targets carry over (one-month overrides don't). If the next year
already exists, it is left alone. A closed year can be reopened.

## Pages

| Page | File | Notes |
|---|---|---|
| Dashboard | `views/dashboard.tsx` | Month or year view; figures and simple HTML bars. |
| Ledger | `views/ledger.tsx`, `views/entry-form.tsx` | One table for all three kinds; filters kept per tab in `sessionStorage`. |
| Budget | `views/budget.tsx` | Enter moves down a column; saves on Enter or blur. |
| Reports | `views/reports.tsx` | Loaded on demand (see Charts). Earning, Expense, and Savings and investment reports are tabbed sections; each remembers its tab in `sessionStorage`. |
| Accounts | `views/accounts.tsx` | Accounts can be deleted only when no entry uses them. Categories always (entries move to Uncategorized), and tags always (they come off their entries). |
| Over the years | `views/years.tsx` | In the menu only with two or more years; the year picker shows "All years" there. Loads every year (`loadAllYears` in `state.ts`, upgraded in memory like `openYear`) and runs `summarize` on each, everyone together. Loaded on demand with the charts. |
| Settings | `views/settings.tsx`, `views/about.tsx` | Import, export, close/reopen, delete a year, start from scratch, the year's IRA settings, appearance, offline, erase everything, the demo file, about. |

Routing is by URL hash (`#/ledger`), which works on any static host.

### Keyboard

- Ledger: <kbd>E</kbd> / <kbd>I</kbd> / <kbd>T</kbd> add an expense, earning or
  transfer; <kbd>/</kbd> searches. On a selected row, <kbd>Enter</kbd> edits and
  <kbd>D</kbd> duplicates (the ⧉ button at the end of each row does too).
- Entry form: <kbd>Enter</kbd> saves from any field, dropdowns included;
  <kbd>Esc</kbd> closes. After adding, the form stays open with the same date and
  accounts and the cursor back in Item, ready for the next entry.
- Tags box: <kbd>Enter</kbd> or <kbd>,</kbd> adds a tag (a new name creates it);
  <kbd>Backspace</kbd> in the empty box removes the last one.
- Budget and Accounts cells: <kbd>Enter</kbd> saves (on Budget, then moves down
  the column); <kbd>Esc</kbd> puts the old value back.

New entry ids are `<kind letter>_<time in base 36><4 random hex>`, so they sort by
when they were made: the ledger shows the newest first within a day. Imported ids
(`e0001`) sort before them.

## Charts

`views/chart.tsx` wraps ECharts 6 and registers only the parts used (sankey, bar,
line, pie; grid, legend, title, tooltip; label layout, which moves overlapping labels apart; SVG renderer). A chart type or component
used without being registered draws nothing, silently: register it there first. The Reports and Over the years pages are separate chunks
loaded when first opened (`chartPage` in `app.tsx`), so ECharts (~200 kB gzipped) never slows the rest of
the app.

Chart colours are CSS tokens (`--series-1` … `--series-10` in `style.css`), with
separate light and dark steps. One idea keeps one colour on every chart: earnings
`--series-1`, spending `--series-2`, savings `--series-3`, investing `--series-4`,
loans `--series-6`; a lighter shade on top of a bar is the rest of the same thing
(net earned solid, other earnings lighter). The palette was checked for colour-blind
separation against the app's light (`#ffffff`) and dark (`#1f1f21`) surfaces.
Three light-mode colours are below 3:1 contrast, so every chart has a table view
under it. Charts use the first six (`seriesColors()`): colours follow the category's
rank over the whole year, so they don't change between views, and past six the rest
fold into "Everything else". Only Credit card usage takes ten (`seriesColors(10)`):
past six some pairs sit close, so it also labels every slice. Animation is off
under `prefers-reduced-motion`.

## The Notion importer

`tools/notion_import.py` turns a Notion "Money Tracker" export into a `YearFile`:

```sh
python3 -I tools/notion_import.py "data/Notion-2026" 2026 data/money-tracker-2026.json
python3 -I tools/verify.py data/money-tracker-2026.json "data/Notion-2026"
```

Notion exports `<Table> <year> <id>_all.csv` (all rows) next to filtered views;
only the `_all` files are read. Keep each year's export in `data/Notion-<year>/`.

It reads both template versions: 2025 onwards (`Debited From`, `Credited To`,
credit limits) and 2024 (`Payment Method`, `Earning Source`, `From`/`To`, no
limits). It also reshapes old rows to the current model:

| Old row | Becomes |
|---|---|
| A negative expense | A refund (offset earning) aimed at that category |
| An "Investment" expense (2024) | A transfer to the investment account its tag names |
| A "Travel"/"Vacation" expense | "Personal Care & Activities" with a "Vacation" tag |
| "Return & Refund", "Transfer", "Personal Care & Activites" | "Refunds", "Transfer to external account", the typo fixed |

Empty rows are skipped, and the importer prints what it changed. Every reshaped
row gets a note ("Imported from Notion, where it was …"); `verify.py` and the tests
use it to put the row back the way Notion counted it before comparing totals. The
note strings are repeated in `notion_import.py`, `verify.py` and `tests/notion.ts`:
change all three together.

`verify.py` recomputes every summary figure Notion shows (monthly and yearly) and
every account's closing balance, and compares them to the cent.

## Tests

`npm test` runs everything; `npm run typecheck` checks app and tests (the tests
have their own `tests/tsconfig.json` so Node's types stay out of the app).

- **Fixture tests** run on `tests/fixtures/sample-2026.json`: synthetic data that
  covers every account type and role. Expected numbers are worked out by hand,
  with the arithmetic in comments.
- **Storage tests** use `fake-indexeddb`; `tests/helpers.ts` gives each test an
  empty database.
- **Real-data tests** (`tests/real-data.test.ts`) run for every
  `data/money-tracker-<year>.json` present, and are skipped when there is none:
  the file is valid, survives IndexedDB unchanged, every entry opens in the form
  and saves back byte for byte, and the report functions add up. With
  `data/Notion-<year>/` present they also compare every figure with Notion's
  export. Consecutive years are checked to roll into each other.

No real figure is ever written into a test: expected values are read from Notion's
export at test time, so the repository can be public.

## Privacy

- `data/` is in `.gitignore`. Real data never goes into the repository; tests that
  need it read it locally.
- The app makes no network requests of its own: code and charts are bundled, text
  uses the system's fonts, and there is no analytics. The README promises users
  their data "is never sent anywhere"; anything that changes that (analytics, a
  font or script from another site, a sync feature) must update that promise too.
