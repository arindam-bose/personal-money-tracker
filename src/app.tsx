import { useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import { requestPersistence, daysSince } from "./storage";
import { current, openYear, persistState, years } from "./state";
import { DataView } from "./views/data";
import { LedgerView } from "./views/ledger";

/** Pages, by URL hash (#/ledger). Hash links work on any static host with no server setup. */
const PAGES = {
  ledger: { label: "Ledger", view: LedgerView },
  data: { label: "Data", view: DataView },
} as const;
type Page = keyof typeof PAGES;

function pageFromHash(): Page {
  const name = location.hash.replace(/^#\/?/, "");
  return name in PAGES ? (name as Page) : "ledger";
}

/** Remind about backups after this many days. */
const BACKUP_AFTER_DAYS = 7;

export function App() {
  const page = useSignal<Page>(pageFromHash());

  useEffect(() => {
    requestPersistence().then((s) => (persistState.value = s));
    openYear();
    const onHash = () => (page.value = pageFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const View = PAGES[page.value].view;
  const setup = current.value?.setup;
  const backupDays = setup && !setup.closed ? daysSince(setup.lastBackupAt) : null;
  const needsBackup = setup && !setup.closed && (backupDays === null || backupDays >= BACKUP_AFTER_DAYS);

  return (
    <>
      <header class="topbar">
        <h1>Money Tracker</h1>
        <nav>
          {(Object.keys(PAGES) as Page[]).map((p) => (
            <a href={`#/${p}`} class={p === page.value ? "active" : ""} aria-current={p === page.value ? "page" : undefined}>
              {PAGES[p].label}
            </a>
          ))}
        </nav>
        <div class="topbar-right">
          {needsBackup && (
            <a href="#/data" class="backup-nag">
              {backupDays === null ? "Not backed up yet" : `Last backup ${backupDays} days ago`}
            </a>
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
