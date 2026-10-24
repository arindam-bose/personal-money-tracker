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
Bump Y with every committed change, and keep `package-lock.json` in step.

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
| `src/derive.ts` | Every computed figure. Plain functions, no UI. |
| `src/entries.ts` | Entry-form logic: drafts, checks, transfer-category suggestion, duplicating. |
| `src/setup.ts` | Editing accounts, categories, tags, people; a blank year's defaults. |
| `src/rollover.ts` | What the next year starts with when a year is closed. |
| `src/state.ts` | The open year as Preact signals, and the actions that change it. |
| `src/views/` | One Preact view per page, plus `chart.tsx` (the ECharts wrapper). |
| `tools/` | Python: Notion export to JSON (`notion_import.py`), and a checker (`verify.py`). |
| `tests/` | Vitest. `fixtures/` holds synthetic data only. |
| `data/` | Your real data and Notion exports. Git-ignored; never commit it. |

## Data model

One year is one `YearFile` (`src/types.ts`): accounts, categories, tags, people,
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
| Earning | `paycheck`, `income`, `offset` (refunds, points: lowers spending), `reimbursement` (someone paying you back) |
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

### Shared costs

An expense can carry `owed: { person, amount }`: the part someone else owes back.
When they pay, that's an earning in a `reimbursement` category with `person` set.
What each person still owes is the sum of their shares minus what they paid back
(`receivables` in `derive.ts`). Nothing is carried across years: a debt still open
at year end is logged as "Transfer to external account" in one year and repaid as
an earning in the next.

## How the figures are worked out

All in `src/derive.ts`, checked against Notion's own totals for 2024–2026 (see
Tests).

| Figure | Formula |
|---|---|
| Earned | All earnings (Notion's gross view) |
| Spent | All expenses, split bank / card / cash by the debited account's type |
| Surplus | Earned − spent |
| Net spending | Spent − offsets − owed shares |
| Net earnings | Earnings in paycheck/income categories not marked `net: false` |
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
Spending against a budget is net: minus owed shares and minus refunds aimed at
that category (`offsets` on the earning). Refunds aimed at no category lower the
total only, shown as their own line so the bottom line equals net spending.

**Money flow** (the Sankey, `moneyFlow`): earnings by category flow into one
"Income" hub, which flows out to spending categories, savings and investing.
Money taken out of savings, or drawn from balances when outflows beat income,
joins on the income side, so both sides always balance. Card payments and other
moves between your own accounts aren't shown.

## Storage

`src/db.ts`. One IndexedDB database, `money-tracker`, with five stores:

- `years`: one setup per year (accounts, categories, tags, people, budgets, plus
  `closed` and `lastBackupAt`), keyed by year.
- `expenses`, `earnings`, `transfers`: one record per entry, keyed by
  `[year, id]`, because ids like `e0001` repeat every year.
- `settings`: app-wide values (IRA limit, pinned tags, the year last opened).

Replacing a year on import runs in one transaction: if anything fails, the old
data stays. The app calls `navigator.storage.persist()` on start so the browser
doesn't clear the data under storage pressure; the Data page shows whether it
agreed and can ask again.

### State changes

`src/state.ts` holds the open year in a signal (`current`). Every change goes
through an action that writes to IndexedDB first, then updates the signal.
**Actions run one at a time** (`inTurn`), each reading the latest state when its
turn comes. Without that, two quick changes (typing budgets down a column, rapid
ledger saves) read the same old setup and the second overwrote the first;
`tests/state.test.ts` guards against it.

### Backups

A backup is the year's `YearFile`, downloaded from the Data page or the top-bar
reminder (shown after 7 days without one, for years with entries). Importing a
file counts as a backup made at its `exportedAt` time. JSON keys are written in a
fixed order, so two backups of the same year diff cleanly.

### Closing a year

`closeYear` makes the year read-only and starts the next one
(`nextYearSetup` in `rollover.ts`): bank, cash and card accounts open at their
closing balance, investment accounts at 0; accounts, categories, tags, people and
usual budget targets carry over (one-month overrides don't). If the next year
already exists, it is left alone. A closed year can be reopened.

## Pages

| Page | File | Notes |
|---|---|---|
| Dashboard | `views/dashboard.tsx` | Month or year view; figures and simple HTML bars. |
| Ledger | `views/ledger.tsx`, `views/entry-form.tsx` | One table for all three kinds; filters kept per tab in `sessionStorage`. |
| Budget | `views/budget.tsx` | Enter moves down a column; saves on Enter or blur. |
| Reports | `views/reports.tsx` | Loaded on demand (see Charts). |
| Accounts | `views/accounts.tsx` | Accounts and people can be deleted only when no entry uses them. Categories always (entries move to Uncategorized), and tags always (they come off their entries). |
| Data | `views/data.tsx` | Import, export, close/reopen, start from scratch, settings. |

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
