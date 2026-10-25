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
| `src/members.ts` | The default member and `membersOf`, apart so `entries.ts` can use them without an import loop. |
| `src/rollover.ts` | What the next year starts with when a year is closed. |
| `src/state.ts` | The open year as Preact signals, and the actions that change it. |
| `src/views/` | One Preact view per page, plus `chart.tsx` (the ECharts wrapper) and `people.tsx` (the person picker). |
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
- **Balances use the net-worth sign.** A card that owes money has a negative
  balance. For every account: `balance = opening + money in − money out`.
- **Nothing computed is stored.** Balances, totals and budget progress are worked
  out from the entries each time (a year is ~1,000 rows; this is fast).

### Roles

Categories carry a hidden **role**, so users can rename them and the reports still
know what each one means:

| Kind | Roles |
|---|---|
| Expense | none (regular), `charity`, `loan` |
| Earning | `paycheck`, `income`, `offset` (refunds, points, money paid back: lowers spending) |
| Transfer | `cc_payment`, `savings_in`, `savings_out`, `invest_retirement`, `invest_taxable`, `cash_withdrawal`, `general` |

Earning and transfer categories must have a role; the validator refuses a file
without one. Earning categories with a `paycheck` or `income` role may also carry
`net: false` to leave them out of **net earnings** (for one-offs such as an
insurance payout). Left out, they count.

### Uncategorized

Each kind has an **Uncategorized** category (`ce_`/`ci_`/`ct_uncategorized`). It
can't be deleted. Deleting any other category moves its entries there, and a
refund aimed at a deleted expense category is re-aimed there too. The setup
change and the moved entries are written in one transaction (`deleteCategory`
in `setup.ts`, `removeCategory` in `state.ts`). The roles keep moved entries out
of the headline figures: the earning one is `income` with `net: false`, and the
transfer one is `general`. A new year starts with it, and an open year that
doesn't have it gets it when it's opened.

### Members (a household)

`members` on the year lists the household; left out, it's one default member,
"Person A" (`membersOf` in `members.ts`). The first member is the default: an entry
carries `member` only when it belongs to someone else, so a one-person year looks
exactly as before. Deleting a member drops `member` from their entries, which
gives them back to the default; the default can't be deleted.

A member's dashboard and reports use `forMember` (`derive.ts`): the ledger with
only their entries and every account. So their earned, spent, net figures,
savings and investing add up across members to the household's. Balances (net
tangible assets, the Accounts card, Balances over time) and budgets are the
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
| Net spending | Spent (Uncategorized included) − earnings in `offset` ("Lowers spending") categories (`spendingOffsetCategories`) |
| Net savings | `savings_in` − `savings_out` transfers |
| Investment | `invest_retirement` + `invest_taxable` transfers |
| Savings / investment / charity rate | As a share of paycheck income |
| Available cash | Checking + savings + cash balances |
| Card debt, utilization | −(card balances); debt ÷ total limits |
| Net tangible assets | Available cash − card debt (investments left out) |

Investment accounts track contributions this year, not market value; they open
at 0 every year.

**Budgets** (`budgetView`): each expense category has a usual monthly target
(`budgets.default`) and optional one-month overrides (`budgets["2026-03"]`).
Spending against a budget is net of refunds aimed at that category (`offsets` on
the earning). Refunds aimed at no category lower the
total only, shown as their own line so the bottom line equals net spending.

**Money flow** (the Sankey, `moneyFlow`): earnings by category flow into one
"Income" hub, which flows out to spending categories, savings and investing.
Money taken out of savings, or drawn from balances when outflows beat income,
joins on the income side, so both sides always balance. Card payments and other
moves between your own accounts aren't shown.

## Storage

`src/db.ts`. One IndexedDB database, `money-tracker`, with five stores:

- `years`: one setup per year (accounts, categories, tags, members, budgets,
  the IRA limit if one is set, plus `closed` and `lastBackupAt`), keyed by year.
- `expenses`, `earnings`, `transfers`: one record per entry, keyed by
  `[year, id]`, because ids like `e0001` repeat every year.
- `settings`: app-wide values (pinned tags, the year last opened).

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
reminder (shown after 7 days without one, for years with entries). Importing a
file counts as a backup made at its `exportedAt` time. JSON keys are written in a
fixed order, so two backups of the same year diff cleanly.
Backups are named `money-tracker-<year>_<date>_<time>_<browser>_<system>.json`
(`backupFileName` in `backup.ts`, `src/device.ts`), e.g.
`money-tracker-2026_2026-10-25_21-05-09_chrome_linux.json`: local time, to the
second, so backups from different days and devices sit side by side.

A backup holds everything needed to rebuild the year on a clean device:

- `closed: true` for a closed year, so it comes back read-only (left out while open).
- `iraLimit`, the year's IRA limit: the one set on the Settings page, or else the IRS
  limit for that year. Every backup writes it; in older files without it, the IRS
  limit applies (`IRA_LIMITS` in `setup.ts`; years past the list use the
  latest one). Add the new limit there when the IRS announces it. A closed
  year's limit doesn't carry into the next year.
- `settings.pinnedTags`, the dashboard's pinned tags. They are app-wide, so
  importing applies them only when the device has none saved yet; restoring an
  old year never undoes today's pins.

All three are optional on import, so older backups still import. `tests/transfer.test.ts`
moves a year that uses every optional field to a clean device and back; its file
is typed `Required<YearFile>`, so a field added later must be added there too. What is left out on
purpose: `lastBackupAt` (an import counts as a backup at `exportedAt`), the year
last opened, and per-tab filters and periods.

### Closing a year

`closeYear` makes the year read-only and starts the next one
(`nextYearSetup` in `rollover.ts`): bank, cash and card accounts open at their
closing balance, investment accounts at 0; accounts, categories, tags and
usual budget targets carry over (one-month overrides don't). If the next year
already exists, it is left alone. A closed year can be reopened.

## Pages

| Page | File | Notes |
|---|---|---|
| Dashboard | `views/dashboard.tsx` | Month or year view; figures and simple HTML bars. |
| Ledger | `views/ledger.tsx`, `views/entry-form.tsx` | One table for all three kinds; filters kept per tab in `sessionStorage`. |
| Budget | `views/budget.tsx` | Enter moves down a column; saves on Enter or blur. |
| Reports | `views/reports.tsx` | Loaded on demand (see Charts). |
| Accounts | `views/accounts.tsx` | Accounts can be deleted only when no entry uses them. Categories always (entries move to Uncategorized), and tags always (they come off their entries). |
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
line; grid, legend, tooltip; SVG renderer). The Reports page is a separate chunk
loaded when first opened, so ECharts (~200 kB gzipped) never slows the rest of
the app.

Chart colours are CSS tokens (`--series-1` … `--series-6` in `style.css`), with
separate light and dark steps. The palette was checked for colour-blind
separation against the app's light (`#ffffff`) and dark (`#1f1f21`) surfaces.
Three light-mode colours are below 3:1 contrast, so every chart has a table view
under it. Colours follow the category's rank over the whole year, so they don't
change between views; past six categories the rest fold into "Other". Animation
is off under `prefers-reduced-motion`.

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
