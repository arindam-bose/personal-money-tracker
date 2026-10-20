# Money Tracker

A personal finance tracker that runs entirely in the browser. You enter expenses,
earnings and transfers by hand. Everything is stored in your browser (IndexedDB),
and a JSON export of each year is the backup. There is no server and no account.

## Develop

Needs Node 22 (`nvm use` picks it up from `.nvmrc`).

```sh
npm install
npm run dev        # dev server
npm test           # unit tests (Vitest)
npm run typecheck  # app and tests
npm run build      # static site in dist/
```

## Layout

- `src/types.ts`: the data model. Amounts are integer cents.
- `src/validate.ts`: checks an imported JSON file before anything is stored.
- `src/db.ts`: IndexedDB storage.
- `src/backup.ts`: JSON import and export.
- `src/derive.ts`: every computed figure (totals, balances, rates). Nothing computed is stored.
- `src/entries.ts`: entry-form logic: drafts, validation, transfer-category suggestion.
- `src/state.ts`: the open year as Preact signals, and the actions that change it
  (run one at a time, so quick successive changes can't overwrite each other).
- `src/setup.ts`: editing accounts, categories, tags and people; a blank year's defaults.
- `src/rollover.ts`: what the next year starts with when a year is closed.
- `src/views/`: Preact views. `chart.tsx` wraps ECharts; the Reports page (and ECharts)
  only loads when opened.
- `tools/`: Python scripts that convert a Notion export (`notion_import.py`) and check
  the result against Notion's own totals (`verify.py`).
- `tests/fixtures/`: synthetic data only.

## Ledger shortcuts

- <kbd>E</kbd> / <kbd>I</kbd> / <kbd>T</kbd>: add an expense, earning or transfer
- <kbd>/</kbd>: search
- On a selected row: <kbd>Enter</kbd> edits it, <kbd>D</kbd> duplicates it (the copy's item ends in "-new").
  The ⧉ button at the end of each row duplicates too.
- In the form: <kbd>Enter</kbd> saves (from any field), <kbd>Esc</kbd> closes. After adding,
  the form stays open with the same date and accounts for the next entry.
- In the tags box: <kbd>Enter</kbd> or <kbd>,</kbd> adds a tag (a new name creates it),
  <kbd>Backspace</kbd> removes the last one.

## Privacy

`data/` holds real financial data and is git-ignored. Never commit it.
Tests that use real data read `data/money-tracker-2026.json` when it exists and are
skipped when it doesn't.
