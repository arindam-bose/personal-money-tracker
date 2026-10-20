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
- `src/views/`: Preact views.
- `tools/`: Python scripts that convert a Notion export (`notion_import.py`) and check
  the result against Notion's own totals (`verify.py`).
- `tests/fixtures/`: synthetic data only.

## Privacy

`data/` holds real financial data and is git-ignored. Never commit it.
Tests that use real data read `data/money-tracker-2026.json` when it exists and are
skipped when it doesn't.
