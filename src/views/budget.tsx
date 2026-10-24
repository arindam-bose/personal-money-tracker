// Budget: monthly targets per expense category (brief §6). A usual target applies to
// every month; any month can override it. Spending is net of refunds and shares owed.

import { useSignal, useSignalEffect } from "@preact/signals";
import { useRef } from "preact/hooks";
import { budgetView, monthKey, monthProgress, type BudgetLine } from "../derive";
import { formatCents, formatPercent, parseCents } from "../money";
import { current, ledger, readOnly, setBudget } from "../state";
import { showInLedger } from "./ledger";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July",
  "August", "September", "October", "November", "December"];
const PERIOD_KEY = "budget-period";

/** Today as "YYYY-MM-DD" in local time. */
function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** The month to open: the one kept for this tab, else this month if it's in the year, else January. */
function initialPeriod(year: number): string {
  try {
    const kept = sessionStorage.getItem(PERIOD_KEY);
    if (kept !== null) return kept;
  } catch {
    // Fall through to the default.
  }
  return Number(today().slice(0, 4)) === year ? String(Number(today().slice(5, 7))) : "1";
}

export function BudgetView() {
  const data = current.value;
  const l = ledger.value;
  /** "ytd" or "1".."12". */
  const period = useSignal(initialPeriod(data?.setup.year ?? 0));
  useSignalEffect(() => {
    try {
      sessionStorage.setItem(PERIOD_KEY, period.value);
    } catch {
      // Not kept; the page still works.
    }
  });

  if (!data || !l) {
    return (
      <section class="panel">
        <h2>Budget</h2>
        <p>No data yet. Go to <a href="#/data">Data</a> to import a year.</p>
      </section>
    );
  }

  const { setup } = data;
  const year = setup.year;
  const lastMonth = Math.max(1, ...l.expenses.map((e) => Number(e.date.slice(5, 7))), Number(today().slice(0, 4)) === year ? Number(today().slice(5, 7)) : 1);
  const month = period.value === "ytd" ? undefined : Number(period.value);
  const months = month ? [month] : Array.from({ length: lastMonth }, (_, i) => i + 1);
  const view = budgetView(l, setup.budgets, year, months);
  const names = new Map(setup.categories.expense.map((c) => [c.id, c.name]));
  const pace = month ? monthProgress(year, month, today()) : null;
  const left = view.budgeted - view.spentBudgeted;
  const editable = month !== undefined && !readOnly.value;

  const step = (by: number) => {
    const m = (month ?? 1) + by;
    if (m >= 1 && m <= 12) period.value = String(m);
  };

  return (
    <div class="budget">
      <div class="filters">
        <button type="button" onClick={() => step(-1)} disabled={!month || month === 1} aria-label="Previous month">‹</button>
        <select value={period.value} onChange={(e) => (period.value = e.currentTarget.value)} aria-label="Month">
          {MONTHS.map((m, i) => <option value={String(i + 1)}>{m} {year}</option>)}
          <option value="ytd">Year to date (Jan–{MONTHS[lastMonth - 1]!.slice(0, 3)})</option>
        </select>
        <button type="button" onClick={() => step(1)} disabled={!month || month === 12} aria-label="Next month">›</button>
      </div>

      <div class="tiles budget-tiles">
        <div class="tile card">
          <div class="tile-label">Budgeted</div>
          <div class="tile-value">{formatCents(view.budgeted)}</div>
          <div class="tile-detail">{view.lines.filter((x) => x.target !== undefined).length} of {view.lines.length} categories</div>
        </div>
        <div class="tile card">
          <div class="tile-label">Spent in budgeted categories</div>
          <div class="tile-value">{formatCents(view.spentBudgeted)}</div>
          <div class="tile-detail">After refunds and shares owed to you</div>
        </div>
        <div class="tile card">
          <div class="tile-label">{left < 0 ? "Over budget" : "Left to spend"}</div>
          <div class={`tile-value ${left < 0 ? "neg" : ""}`}>{formatCents(Math.abs(left))}</div>
          {pace !== null && <div class="tile-detail">{formatPercent(pace)} of the month has gone by</div>}
        </div>
      </div>

      <section class="card">
        {view.budgeted === 0 && editable && (
          <p class="hint-box">
            Type a monthly target in <b>Every month</b> for the categories you want to track.
            Use <b>This month only</b> when one month is different, like a holiday. Enter saves and moves down.
          </p>
        )}
        <table class="budget-table">
          <thead>
            <tr>
              <th>Category</th>
              {month ? (
                <>
                  <th class="num">Every month</th>
                  <th class="num">This month only</th>
                </>
              ) : (
                <th class="num">Budgeted</th>
              )}
              <th class="num">Spent</th>
              <th class="num">Left</th>
              <th class="c-progress"><span class="sr-only">Progress</span></th>
            </tr>
          </thead>
          <tbody>
            {view.lines.map((line, row) => (
              <tr key={line.cat}>
                <td>
                  <a href="#/ledger" onClick={(e) => { e.preventDefault(); showCategory(line.cat, month); }}>
                    {names.get(line.cat) ?? line.cat}
                  </a>
                </td>
                {month ? (
                  <>
                    <td class="num">
                      <MoneyInput value={setup.budgets.default[line.cat]} placeholder="No budget" disabled={!editable}
                        label={`${names.get(line.cat)} every month`} row={row} col={0}
                        onCommit={(v) => setBudget("default", line.cat, v)} />
                    </td>
                    <td class="num">
                      <MoneyInput value={setup.budgets[monthKey(year, month)]?.[line.cat]} placeholder="Same" disabled={!editable}
                        label={`${names.get(line.cat)} in ${MONTHS[month - 1]} only`} row={row} col={1}
                        onCommit={(v) => setBudget(monthKey(year, month), line.cat, v)} />
                    </td>
                  </>
                ) : (
                  <td class="num">{line.target === undefined ? <span class="muted">–</span> : formatCents(line.target)}</td>
                )}
                <td class="num">{formatCents(line.spent)}</td>
                <td class="num"><Left line={line} /></td>
                <td class="c-progress"><BudgetBar line={line} pace={pace} /></td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            {view.untargetedOffsets > 0 && (
              <tr>
                <td colSpan={month ? 3 : 2}>Refunds and points not tied to a category</td>
                <td class="num">−{formatCents(view.untargetedOffsets)}</td>
                <td colSpan={2} />
              </tr>
            )}
            <tr class="total">
              <td colSpan={month ? 3 : 2}>Net spending</td>
              <td class="num">{formatCents(view.netSpent)}</td>
              <td colSpan={2} />
            </tr>
          </tfoot>
        </table>
        {!month && <p class="muted small">Year to date adds up each month's target, including months that were overridden. Pick a month to change targets.</p>}
        {readOnly.value && <p class="muted small">{year} is closed, so its budget can't be changed.</p>}
      </section>
    </div>
  );
}

function showCategory(cat: string, month: number | undefined) {
  showInLedger({ cat, kind: "expense", month: month ? String(month) : "" });
}

/** "Left" cell: amount left, or how far over in words (never colour alone). */
function Left({ line }: { line: BudgetLine }) {
  if (line.remaining === undefined) return <span class="muted">–</span>;
  return line.remaining < 0
    ? <span class="over">Over by {formatCents(-line.remaining)}</span>
    : <>{formatCents(line.remaining)}</>;
}

/**
 * Spent against target as a bar. Over budget fills completely in the warning colour.
 * The tick marks how much of the month has passed, so you can see if spending is ahead of pace.
 */
export function BudgetBar({ line, pace }: { line: BudgetLine; pace: number | null }) {
  if (line.target === undefined) return null;
  const used = line.target > 0 ? Math.max(0, line.spent) / line.target : line.spent > 0 ? Infinity : 0;
  return (
    <span class={`budget-bar ${used > 1 ? "over" : ""}`} aria-hidden="true">
      <span class="fill" style={{ width: `${Math.min(1, used) * 100}%` }} />
      {pace !== null && <span class="pace" style={{ left: `${pace * 100}%` }} title="Today" />}
    </span>
  );
}

/**
 * A money cell that saves on Enter or when you leave it. Empty clears the value.
 * Enter also moves to the same column in the next row; Esc puts the old value back.
 */
function MoneyInput(props: {
  value: number | undefined;
  placeholder: string;
  label: string;
  disabled: boolean;
  row: number;
  col: number;
  onCommit: (cents: number | null) => void;
}) {
  const shown = props.value === undefined ? "" : (props.value / 100).toFixed(2);
  const invalid = useSignal(false);
  // Enter saves and then moves focus, which fires blur: remember what was sent so it isn't sent twice.
  const sent = useRef(shown);

  function commit(input: HTMLInputElement) {
    const text = input.value.trim();
    if (text === sent.current) return;
    const cents = text === "" ? null : parseCents(text);
    if (text !== "" && cents === null) {
      invalid.value = true;
      return;
    }
    invalid.value = false;
    sent.current = text;
    props.onCommit(cents);
  }

  function onKeyDown(e: KeyboardEvent) {
    const input = e.currentTarget as HTMLInputElement;
    if (e.key === "Enter") {
      e.preventDefault();
      commit(input);
      const next = document.querySelector<HTMLInputElement>(`input[data-row="${props.row + 1}"][data-col="${props.col}"]`);
      next ? next.focus() : input.blur();
    } else if (e.key === "Escape") {
      input.value = shown;
      invalid.value = false;
      input.blur();
    }
  }

  return (
    <input type="text" inputMode="decimal" class={`money-input num ${invalid.value ? "invalid" : ""}`}
      // A key tied to the stored value resets the box whenever the value changes elsewhere.
      key={shown} defaultValue={shown} placeholder={props.placeholder} aria-label={props.label}
      aria-invalid={invalid.value} title={invalid.value ? "Enter an amount like 250 or 250.50" : undefined}
      disabled={props.disabled} data-row={props.row} data-col={props.col}
      onKeyDown={onKeyDown} onBlur={(e) => commit(e.currentTarget)} onFocus={(e) => e.currentTarget.select()} />
  );
}
