import { useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { version } from "../package.json";
import { chooseConsent, consentAsked } from "./analytics";
import { downloadYear } from "./backup";
import { dateTime, lastUpdatedAt } from "./derive";
import { updateReady } from "./offline";
import { backupDue, daysSince, requestPersistence } from "./storage";
import { current, loadSettings, openYear, persistState, years } from "./state";
import type { ComponentType } from "preact";
import { AccountsView } from "./views/accounts";
import { BudgetView } from "./views/budget";
import { DashboardView } from "./views/dashboard";
import { LedgerView } from "./views/ledger";
import { SettingsView } from "./views/settings";

/** Pages with charts pull in the charting library, so their code is only downloaded when first opened. */
function chartPage(load: () => Promise<ComponentType>): ComponentType {
  return function ChartPage() {
    const view = useSignal<ComponentType | null>(null);
    const failed = useSignal(false);
    useEffect(() => {
      // It can fail when a newer version replaced the files this tab was opened with,
      // or with no signal before the offline copy was made: a reload fetches the current ones.
      load().then((v) => (view.value = v), () => (failed.value = true));
    }, []);
    const View = view.value;
    if (View) return <View />;
    return failed.value ? (
      <p class="muted">
        The charts couldn't load: this tab is running an older version of the tracker.{" "}
        <button type="button" class="link" onClick={() => location.reload()}>Reload</button>
      </p>
    ) : <p class="muted">Loading charts…</p>;
  };
}

/** Pages, by URL hash (#/ledger). Hash links work on any static host with no server setup. */
const PAGES = {
  dashboard: { label: "Dashboard", view: DashboardView },
  ledger: { label: "Ledger", view: LedgerView },
  budget: { label: "Budget", view: BudgetView },
  reports: { label: "Reports", view: chartPage(() => import("./views/reports").then((m) => m.ReportsView)) },
  accounts: { label: "Accounts", view: AccountsView },
  // Only in the menu with two or more years.
  years: { label: "Over the years", view: chartPage(() => import("./views/years").then((m) => m.YearsView)) },
  settings: { label: "Settings", view: SettingsView },
} as const;
type Page = keyof typeof PAGES;

/** Old page names, so bookmarks made before a rename still open the right page. */
const RENAMED: Record<string, Page> = { data: "settings" };

function pageFromHash(): Page {
  const name = location.hash.replace(/^#\/?/, "");
  return name in PAGES ? (name as Page) : RENAMED[name] ?? "dashboard";
}

export function App() {
  const page = useSignal<Page>(pageFromHash());
  /** On a phone the page links fold into a menu, opened by ☰. */
  const menuOpen = useSignal(false);

  useEffect(() => {
    requestPersistence().then((s) => (persistState.value = s));
    openYear();
    loadSettings();
    const onHash = () => {
      page.value = pageFromHash();
      menuOpen.value = false;
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  // An open menu closes on Esc, or on a tap anywhere outside it.
  useEffect(() => {
    if (!menuOpen.value) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !(e.target as Element).closest(".topbar nav, .menu-btn")) menuOpen.value = false;
    };
    document.addEventListener("keydown", close);
    document.addEventListener("pointerdown", close);
    return () => {
      document.removeEventListener("keydown", close);
      document.removeEventListener("pointerdown", close);
    };
  }, [menuOpen.value]);

  const View = PAGES[page.value].view;
  const setup = current.value?.setup;
  const backupDays = setup && !setup.closed ? daysSince(setup.lastBackupAt) : null;
  const hasEntries = !!current.value && current.value.expenses.length + current.value.earnings.length + current.value.transfers.length > 0;
  const needsBackup = setup && backupDue(setup, hasEntries);
  const updated = setup && lastUpdatedAt(setup);

  async function backUpNow() {
    if (!setup) return;
    await downloadYear(setup.year);
    await openYear(setup.year);
  }

  return (
    <>
      <header class="topbar">
        {/* The title goes home: the Dashboard. */}
        <h1><a href="#/" class="home-link">Money Tracker</a> <span class="version">v{version}</span></h1>
        {/* Picking a page closes the menu, even the page already open (the address doesn't change then). */}
        <nav id="pages" class={menuOpen.value ? "open" : ""} onClick={(e) => (e.target as Element).closest("a") && (menuOpen.value = false)}>
          {(Object.keys(PAGES) as Page[]).filter((p) => p !== "years" || years.value.length > 1).map((p) => (
            <a href={`#/${p}`} class={p === page.value ? "active" : ""} aria-current={p === page.value ? "page" : undefined}>
              {PAGES[p].label}
            </a>
          ))}
        </nav>
        <div class="topbar-right">
          {updateReady.value && (
            <button type="button" class="backup-nag" onClick={() => location.reload()}
              title="A newer version is downloaded and ready.">
              <span class="long">v{updateReady.value} is ready · </span>Reload
            </button>
          )}
          {needsBackup && (
            <button type="button" class="backup-nag" onClick={backUpNow}
              title="Downloads this year as a JSON file. Your data lives only in this browser.">
              <span class="long">{backupDays === null ? "Not backed up yet" : `Last backup ${backupDays} days ago`} · </span>Back up<span class="long"> now</span>
            </button>
          )}
          {/* Over the years covers every year, so the picker steps aside there. */}
          {page.value === "years" && years.value.length > 1 ? <span class="muted">All years</span> : years.value.length > 0 && (
            <select aria-label="Year" value={setup?.year} onChange={(e) => openYear(Number(e.currentTarget.value))}>
              {years.value.map((y) => <option value={y.setup.year}>{y.setup.year}</option>)}
            </select>
          )}
          <button type="button" class="menu-btn" aria-label="Pages" aria-controls="pages" aria-expanded={menuOpen.value}
            onClick={() => (menuOpen.value = !menuOpen.value)}>☰</button>
        </div>
      </header>
      {/* One time for the open year: its latest change, to an entry or to its setup. */}
      {updated && (
        <div class="status-strip">
          <p>Last updated {dateTime(updated)}</p>
        </div>
      )}
      <main>
        <View />
      </main>
      <footer class="footer">
        © 2026 - Made with love by <a href="https://arindambose.com/" target="_blank" rel="noopener noreferrer">Arindam Bose</a>,
        powered by <a href="https://claude.ai/" target="_blank" rel="noopener noreferrer">Claude</a>
        <br />
        Your ledger stays in this browser: nothing is uploaded, and it works offline.
      </footer>
      {consentAsked.value && <ConsentBanner />}
    </>
  );
}

/** The cookie question: on first visit, and again from Cookie settings in the About card. */
function ConsentBanner() {
  const first = useRef<HTMLButtonElement>(null);
  // Opened from Cookie settings, focus follows it here; on a first visit it doesn't steal focus from the page.
  useEffect(() => {
    if (document.activeElement?.closest(".facts")) first.current?.focus();
  }, []);
  return (
    <section class="consent" aria-label="Cookie consent">
      <p class="consent-text">
        <strong>May we count your visit?</strong> Google Analytics would set cookies to count visits
        to this site. It never sees what you log in the ledger, and nothing loads unless you say yes.
        Every feature works either way, and you can change your mind any time under Cookie settings,
        in the tool's Settings.
      </p>
      <div class="consent-actions">
        <button type="button" ref={first} onClick={() => chooseConsent("denied")}>Decline</button>
        <button type="button" class="primary" onClick={() => chooseConsent("granted")}>Accept</button>
      </div>
    </section>
  );
}
