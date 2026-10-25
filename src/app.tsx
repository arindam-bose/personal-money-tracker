import { useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import { version } from "../package.json";
import { downloadYear } from "./backup";
import { requestPersistence, daysSince } from "./storage";
import { current, loadSettings, openYear, persistState, years } from "./state";
import type { ComponentType } from "preact";
import { AccountsView } from "./views/accounts";
import { BudgetView } from "./views/budget";
import { DashboardView } from "./views/dashboard";
import { LedgerView } from "./views/ledger";
import { SettingsView } from "./views/settings";

/** Reports pull in the charting library, so their code is only downloaded when first opened. */
function ReportsPage() {
  const view = useSignal<ComponentType | null>(null);
  useEffect(() => {
    import("./views/reports").then((m) => (view.value = m.ReportsView));
  }, []);
  const View = view.value;
  return View ? <View /> : <p class="muted">Loading charts…</p>;
}

/** Pages, by URL hash (#/ledger). Hash links work on any static host with no server setup. */
const PAGES = {
  dashboard: { label: "Dashboard", view: DashboardView },
  ledger: { label: "Ledger", view: LedgerView },
  budget: { label: "Budget", view: BudgetView },
  reports: { label: "Reports", view: ReportsPage },
  accounts: { label: "Accounts", view: AccountsView },
  settings: { label: "Settings", view: SettingsView },
} as const;
type Page = keyof typeof PAGES;

/** Old page names, so bookmarks made before a rename still open the right page. */
const RENAMED: Record<string, Page> = { data: "settings" };

function pageFromHash(): Page {
  const name = location.hash.replace(/^#\/?/, "");
  return name in PAGES ? (name as Page) : RENAMED[name] ?? "dashboard";
}

/** Remind about backups after this many days. */
const BACKUP_AFTER_DAYS = 7;

export function App() {
  const page = useSignal<Page>(pageFromHash());

  useEffect(() => {
    requestPersistence().then((s) => (persistState.value = s));
    openYear();
    loadSettings();
    const onHash = () => (page.value = pageFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const View = PAGES[page.value].view;
  const setup = current.value?.setup;
  const backupDays = setup && !setup.closed ? daysSince(setup.lastBackupAt) : null;
  const hasEntries = !!current.value && current.value.expenses.length + current.value.earnings.length + current.value.transfers.length > 0;
  const needsBackup = setup && !setup.closed && hasEntries && (backupDays === null || backupDays >= BACKUP_AFTER_DAYS);

  async function backUpNow() {
    if (!setup) return;
    await downloadYear(setup.year);
    await openYear(setup.year);
  }

  return (
    <>
      <header class="topbar">
        <h1>Money Tracker <span class="version">v{version}</span></h1>
        <nav>
          {(Object.keys(PAGES) as Page[]).map((p) => (
            <a href={`#/${p}`} class={p === page.value ? "active" : ""} aria-current={p === page.value ? "page" : undefined}>
              {PAGES[p].label}
            </a>
          ))}
        </nav>
        <div class="topbar-right">
          {needsBackup && (
            <button type="button" class="backup-nag" onClick={backUpNow}
              title="Downloads this year as a JSON file. Your data lives only in this browser.">
              {backupDays === null ? "Not backed up yet" : `Last backup ${backupDays} days ago`} · Back up now
            </button>
          )}
          {years.value.length > 0 && (
            <select aria-label="Year" value={setup?.year} onChange={(e) => openYear(Number(e.currentTarget.value))}>
              {years.value.map((y) => <option value={y.setup.year}>{y.setup.year}</option>)}
            </select>
          )}
        </div>
      </header>
      <main>
        <View />
      </main>
    </>
  );
}
