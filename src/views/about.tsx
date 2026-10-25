// The About card on the Settings page: what the tool is, how to use it, which release
// this is, and where its code and issues live.

import type { ComponentChildren } from "preact";
import { useRef } from "preact/hooks";
import { released, version } from "../../package.json";

const REPO = "https://github.com/arindam-bose/personal-money-tracker";

/**
 * A "YYYY-MM-DD" day as the reader writes dates, e.g. "25 Oct 2026". Read as UTC:
 * in local time it would land on the day before, west of Greenwich.
 */
function day(iso: string): string {
  const at = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(at.getTime())) return iso;
  return at.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

/** A fact whose term opens a dialog of words. */
function DialogFact(props: { term: string; title: string; children: ComponentChildren }) {
  const dialog = useRef<HTMLDialogElement>(null);
  return (
    <div>
      <dt>
        <button type="button" class="link fact-open" aria-haspopup="dialog" onClick={() => dialog.current?.showModal()}>
          {props.term}
        </button>
      </dt>
      <dd />
      <dialog ref={dialog} class="guide" aria-label={props.title}
        // A click on the backdrop lands on the dialog itself: close it, like Esc does.
        onClick={(e) => e.target === dialog.current && dialog.current?.close()}>
        <div class="guide-body">
          {/* Focus starts on the title, so a long dialog opens at its top, not scrolled to Close. */}
          <h2 tabIndex={-1} autofocus>{props.title}</h2>
          {props.children}
          <div class="form-actions">
            <button type="button" class="primary" onClick={() => dialog.current?.close()}>Close</button>
          </div>
        </div>
      </dialog>
    </div>
  );
}

function LinkFact(props: { term: string; href: string }) {
  return (
    <div>
      <dt>{props.term}</dt>
      <dd><a href={props.href} target="_blank" rel="noopener noreferrer">On GitHub</a></dd>
    </div>
  );
}

export function AboutCard() {
  return (
    <section class="panel settings">
      <h2>About</h2>
      <dl class="facts">
        <DialogFact term="About this tool" title="About Money Tracker">
          <p>Keep track of what you earn, spend, save and invest, one year at a time.</p>
          <p>
            You type in your expenses, earnings and transfers yourself; the tracker works out the
            rest: where your money went, how much you saved, what your cards owe, and how you are
            doing against your monthly budgets.
          </p>
          <h3>Your data stays with you</h3>
          <p>
            There is no account and no server. Everything you enter is stored in your own browser,
            on your own device, and is never sent anywhere. It works without a signal, too.
          </p>
          <p>
            That also means <b>you are the backup</b>. Download a copy of each year now and then
            (the tracker reminds you after a week). If you clear your browser data or switch
            devices, import that file to get everything back.
          </p>
        </DialogFact>
        <DialogFact term="How to use this tool" title="How to use Money Tracker">
          <h3>Getting started</h3>
          <ol>
            <li>On this <b>Settings</b> page, import a Money Tracker backup, or start the year from scratch.
              Starting partway through the year? Pick the day you start: the ledger begins there, and
              budgets and reports count from that month.</li>
            <li>Add your bank accounts, cards and cash on the <b>Accounts</b> page.</li>
            <li>Log what happens on the <b>Ledger</b> page.</li>
          </ol>
          <h3>For the whole family</h3>
          <p>
            One tracker can keep a whole household's money. Everything belongs to <b>Person A</b> until
            you add more people under <b>People</b> on the <b>Accounts</b> page (rename Person A to
            yourself there, too). Then each
            earning, expense or transfer can be logged for the person it belongs to, and the
            Dashboard, Ledger and Reports show <b>All people</b> together or one person at a time.
            Accounts and budgets stay shared by everyone.
          </p>
          <h3>The pages</h3>
          <ul>
            <li><b>Dashboard</b>: the month or year at a glance, with budgets, balances and card use.</li>
            <li><b>Ledger</b>: every earning, expense and transfer, with filters and quick keyboard entry.
              Transfers (paying a card, moving money to savings) aren't spending, so they're shown apart.</li>
            <li><b>Budget</b>: a monthly target for each spending category, with what's left.</li>
            <li><b>Reports</b>: charts of where your money went, month by month and week by week.</li>
            <li><b>Accounts</b>: your accounts, categories, tags and the people in your household.
              Earnings in <b>Lowers spending</b> categories (refunds, points, money paid back) lower net spending.</li>
            <li><b>Settings</b>: back up, import, and close a finished year, which starts the next one
              from its closing balances; each year's IRA limit.</li>
          </ul>
          <h3>Handy keys on the Ledger</h3>
          <table class="data-table keys">
            <tbody>
              <tr><td><kbd>I</kbd> <kbd>E</kbd> <kbd>T</kbd></td><td>Add an earning, expense or transfer</td></tr>
              <tr><td><kbd>/</kbd></td><td>Search</td></tr>
              <tr><td><kbd>Enter</kbd></td><td>Save the form, or edit the selected row</td></tr>
              <tr><td><kbd>Esc</kbd></td><td>Close the form</td></tr>
              <tr><td><kbd>D</kbd></td><td>Duplicate the selected row (the copy's name ends in "-new")</td></tr>
            </tbody>
          </table>
        </DialogFact>
        <div>
          <dt>Tool version</dt>
          <dd>v{version}, updated {day(released)}</dd>
        </div>
        <LinkFact term="Source code" href={REPO} />
        <LinkFact term="Log Issues and request features" href={`${REPO}/issues`} />
      </dl>
    </section>
  );
}
