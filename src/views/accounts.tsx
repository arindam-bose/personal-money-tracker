// Accounts: set up the year's accounts, categories, tags and people (brief §8, view 5).
// Everything is referenced by id, so renaming here never breaks an entry.

import { useSignal } from "@preact/signals";
import { Fragment } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { balances, countsInNetEarnings, hasValuations, localToday, shortDate, valuationOf } from "../derive";
// Every amount on this page goes through this, so Hide the numbers covers them all.
import { maskedCents as formatCents } from "../hide-numbers";
import { parseCents, parseSignedCents } from "../money";
import {
  deleteAccount, deleteValuation, duplicateAccount, memberUses, membersOf, reopenAccount, saveAccount, saveCategory, saveMember, saveTag, saveValuation,
  usageOf, type Usage,
} from "../setup";
import { uncategorizedId, type CategoryKind } from "../categories";
import { current, ledger, readOnly, removeCategory, removeMember, removeTag, setClosed, setStart, updateSetup } from "../state";
import type { Account, AccountType, EarningRole, YearSetup } from "../types";
import { startsMidYear, yearStart } from "../year";
import { DateField } from "./date-field";
import { CardTitle } from "./help";
import { IconButton } from "./icons";
import { NoData } from "./no-data";
import { idByName, useSaved } from "./saved";

const TYPE_LABEL: Record<AccountType, string> = {
  checking: "Checking", savings: "Savings", cash: "Cash", credit: "Credit card", investment: "Investment", loan: "Loan / mortgage", asset: "Asset",
};

/** Plain-language names for the roles that drive the reports. */
const ROLE_LABEL: Record<CategoryKind, Record<string, string>> = {
  expense: { "": "Regular", charity: "Charity" },
  earning: {
    paycheck: "Paycheck", income: "Other income", offset: "Lowers spending", transfer_in: "Transfer from external",
  },
  transfer: {
    cc_payment: "Card payment", savings_in: "Into savings", savings_out: "Out of savings",
    invest_retirement: "Retirement investing", invest_taxable: "Taxable investing",
    cash_withdrawal: "Cash withdrawal", loan_payment: "Loan payment", general: "Other move",
  },
};

const KIND_TITLE: Record<CategoryKind, string> = { expense: "Expense categories", earning: "Earning categories", transfer: "Transfer categories" };

/** Run a change and turn a failure into a message for the user. True if it worked. */
async function tryAction(run: () => Promise<unknown>, onError: (msg: string | null) => void): Promise<boolean> {
  try {
    await run();
    onError(null);
    return true;
  } catch (e) {
    // SetupError explains what to fix; anything else (e.g. a closed year) still has a readable message.
    onError(e instanceof Error ? e.message : String(e));
    return false;
  }
}

/** Run a setup change, as tryAction does. */
function attempt(change: (s: YearSetup, u: Usage) => YearSetup, onError: (msg: string | null) => void): Promise<boolean> {
  return tryAction(() => updateSetup(change), onError);
}

/** Calls `then` when the save went through, and passes the result on. */
async function after(saving: Promise<boolean>, then: () => void): Promise<boolean> {
  const ok = await saving;
  if (ok) then();
  return ok;
}

export function AccountsView() {
  const data = current.value;
  if (!data) {
    return (
      <section class="panel">
        <h2>Accounts</h2>
        <NoData />
      </section>
    );
  }
  const usage = usageOf(data);
  return (
    <div class="setup">
      {readOnly.value && <p class="muted">{data.setup.year} is closed, so its setup can't be changed.</p>}
      <AccountsCard setup={data.setup} usage={usage} />
      <div class="cat-columns">
        {(["earning", "expense", "transfer"] as CategoryKind[]).map((kind) => (
          <CategoryCard kind={kind} setup={data.setup} usage={usage} />
        ))}
      </div>
      <TagsCard tags={data.setup.tags} uses={usage.tags} />
      <PeopleCard setup={data.setup} usage={usage} />
    </div>
  );
}

// --- Accounts ---

function AccountsCard({ setup, usage }: { setup: YearSetup; usage: Usage }) {
  /** The account being added ("new") or edited (its id); null when the form is closed. */
  const editing = useSignal<string | null>(setup.accounts.length === 0 && !readOnly.value ? "new" : null);
  /** The investment account whose balance is being updated, or null. */
  const valuing = useSignal<string | null>(null);
  /** The account whose Close form is open, or null. */
  const closing = useSignal<string | null>(null);
  const error = useSignal<string | null>(null);
  const saved = useSaved();
  const bal = balances(ledger.value!);
  // Open accounts first, then hidden ones, then closed ones.
  const rank = (a: Account) => (a.closedOn ? 2 : a.archived ? 1 : 0);
  const sorted = [...setup.accounts].sort((a, b) => rank(a) - rank(b));

  async function reopen(a: Account) {
    await after(attempt((s) => reopenAccount(s, a.id), (m) => (error.value = m)), () => saved.flash(a.id));
  }

  async function toggleArchive(a: Account) {
    await after(attempt((s) => saveAccount(s, { ...a, archived: !a.archived }), (m) => (error.value = m)), () => saved.flash(a.id));
  }
  async function copy(a: Account) {
    let id = "";
    const ok = await attempt((s) => {
      const r = duplicateAccount(s, a.id);
      id = r.id;
      return r.setup;
    }, (m) => (error.value = m));
    // Open the copy for editing: it usually needs a new name, number or opening balance.
    if (ok) editing.value = id;
  }
  async function remove(a: Account) {
    if (!confirm(`Delete the account “${a.name}”?`)) return;
    await attempt((s, u) => deleteAccount(s, a.id, u), (m) => (error.value = m));
  }

  return (
    <section class="card">
      <div class="card-head">
        <div>
          <CardTitle title="Accounts">
            Opening balances are what each account held {startsMidYear(setup)
              ? <>on the morning of {shortDate(yearStart(setup))}, when tracking began. Nothing before that day is in the ledger.</>
              : <>on January 1, {setup.year}.</>}
          </CardTitle>
          <StartField key={yearStart(setup)} setup={setup} onError={(m) => (error.value = m)} onSaved={() => saved.flash("start")} />
          {saved.mark("start")}
        </div>
        {!readOnly.value && editing.value === null && (
          <button type="button" class="tinted add-earning" onClick={() => (editing.value = "new")}>+ Add</button>
        )}
      </div>

      {editing.value === "new" && (
        <AccountForm onDone={() => (editing.value = null)} onSaved={saved.flash} first={setup.accounts.length === 0} />
      )}
      {error.value && <p class="form-error" role="alert">{error.value}</p>}

      {setup.accounts.length > 0 && (
        <table class="data-table setup-table">
          <thead>
            <tr>
              <th>Name</th><th>Type</th><th>Number</th>
              <th class="num">Opening</th><th class="num">Limit</th><th class="num">Balance now</th>
              <th class="num">Entries</th><th />
            </tr>
          </thead>
          <tbody>
            {sorted.map((a) => editing.value === a.id ? (
              <tr key={a.id}><td colSpan={8}><AccountForm account={a} onDone={() => (editing.value = null)} onSaved={saved.flash} /></td></tr>
            ) : (
              <Fragment key={a.id}>
                <tr class={a.archived || a.closedOn ? "archived" : ""}>
                  <td class="a-name">
                    {a.name}{a.archived && !a.closedOn && <span class="badge">hidden</span>}
                    {a.closedOn && <span class="badge">closed {shortDate(a.closedOn)}</span>}
                    {a.type === "loan" && <div class="tile-detail">{loanText(a)}</div>}
                    {hasValuations(a.type) && !a.closedOn && <div class="tile-detail">{worthText(a)}</div>}
                  </td>
                  <td class="a-meta">{TYPE_LABEL[a.type]}</td>
                  <td class="a-meta">{a.ref}</td>
                  {/* An asset has no opening or ledger balance: only the value it was last updated to. */}
                  <td class="num a-meta" data-label="Opening">{a.type === "asset" ? "" : owes(a) ? owedText(a.opening) : formatCents(a.opening)}</td>
                  <td class="num a-meta" data-label="Limit">{a.limit !== undefined ? formatCents(a.limit) : ""}</td>
                  <td class="num a-balance">{a.type === "asset" ? "" : owes(a) ? owedText(bal.get(a.id) ?? 0) : formatCents(bal.get(a.id) ?? 0)}</td>
                  <td class="num a-meta" data-label="Entries">{usage.accounts.get(a.id) ?? 0}</td>
                  <td class="a-actions">
                    {/* Icons, always shown: each says what it does in its tooltip. */}
                    {!readOnly.value && (
                      <div class="row-actions">
                        {saved.mark(a.id)}
                        {hasValuations(a.type) && !a.closedOn && (
                          <IconButton icon="update" label={`${a.type === "asset" ? "Update value" : "Update balance"} of ${a.name}`}
                            title={`${a.type === "asset" ? "Update value" : "Update balance"}: note what ${a.type === "asset" ? "it" : "the account"} is worth today`}
                            onClick={() => (valuing.value = valuing.value === a.id ? null : a.id)} />
                        )}
                        <IconButton icon="edit" label={`Edit ${a.name}`} title="Edit" onClick={() => (editing.value = a.id)} />
                        <IconButton icon="duplicate" label={`Duplicate ${a.name}`} title={`Duplicate: add a copy named “${a.name} (new)”`}
                          onClick={() => copy(a)} />
                        {a.closedOn ? (
                          <IconButton icon="reopen" label={`Reopen ${a.name}`} title="Reopen: undo closing it. It counts again, and takes entries after that day"
                            onClick={() => reopen(a)} />
                        ) : (
                          <>
                            <IconButton icon="close" label={`Close ${a.name}…`}
                              title="Close…: sold, paid off or shut down for good. Pick the day: from then it's left out of net worth and doesn't carry into next year. Move any money out first, so it ends at $0."
                              onClick={() => (closing.value = closing.value === a.id ? null : a.id)} />
                            <IconButton icon={a.archived ? "unhide" : "hide"} label={`${a.archived ? "Unhide" : "Hide"} ${a.name}`}
                              title={a.archived
                                ? "Unhide: offer it again when you add entries"
                                : "Hide: still open, just not used. It stops being offered for new entries, but it still counts in net worth and carries into next year. Old entries keep it."}
                              onClick={() => toggleArchive(a)} />
                          </>
                        )}
                        {!usage.accounts.get(a.id) && (
                          <IconButton icon="delete" danger label={`Delete ${a.name}`} title="Delete (not used by any entry)" onClick={() => remove(a)} />
                        )}
                      </div>
                    )}
                  </td>
                </tr>
                {valuing.value === a.id && (
                  <tr><td colSpan={8}><ValuationForm account={a} setup={setup} onDone={() => (valuing.value = null)} onSaved={saved.flash} /></td></tr>
                )}
                {closing.value === a.id && !a.closedOn && (
                  <tr><td colSpan={8}><CloseForm account={a} setup={setup} onDone={() => (closing.value = null)} onSaved={saved.flash} /></td></tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

/** "Worth $12,480.00 on Oct 25", or a note that it has no balance yet. */
function worthText(a: Account): string {
  const v = valuationOf(a);
  return v ? `Worth ${formatCents(v.amount)} on ${shortDate(v.date)}` : `No ${valueWord(a)} yet: not in net worth`;
}

/** An investment has a balance; an asset (a house, a car) has a value. */
function valueWord(a: Pick<Account, "type">): string {
  return a.type === "asset" ? "value" : "balance";
}

/** The day an update is for by default: today, or the nearest day of the tracked year. */
function updateDay(setup: YearSetup): string {
  const first = yearStart(setup), last = `${setup.year}-12-31`, today = localToday();
  return today < first ? first : today > last ? last : today;
}

/**
 * Note what an investment account is worth: today by default, or another day in the year.
 * Lists the earlier updates, newest first, so a wrong one can be deleted.
 */
function ValuationForm(props: { account: Account; setup: YearSetup; onDone: () => void; onSaved: (id: string) => void }) {
  const { account: a, setup } = props;
  const first = yearStart(setup), last = `${setup.year}-12-31`;
  const word = valueWord(a);
  const date = useSignal(updateDay(setup));
  const amount = useSignal("");
  const error = useSignal<string | null>(null);
  const amountRef = useRef<HTMLInputElement>(null);
  useEffect(() => amountRef.current?.focus(), []);

  async function onSubmit(e: Event) {
    e.preventDefault();
    const cents = parseCents(amount.value);
    if (cents === null) return void (error.value = `Enter the ${word} like 1234.56.`);
    if (await attempt((s) => saveValuation(s, a.id, date.value, cents), (m) => (error.value = m))) {
      amount.value = "";
      props.onSaved(a.id);
    }
  }

  return (
    <form class="inline-form" onSubmit={onSubmit} onKeyDown={(e) => e.key === "Escape" && props.onDone()}>
      <p class="muted small">
        {a.type === "asset"
          ? <>What {a.name} is worth. Until the next update it counts at this amount in net worth, and a new year starts with it.</>
          : <>What {a.name} is worth, as your broker shows it. Until the next update it counts at this amount in net worth. A new year starts without one.</>}
      </p>
      <div class="fields">
        <DateField label="On" value={date.value} min={first} max={last} onChange={(d) => (date.value = d)} />
        <label class="field w-amount">
          <span class="field-label">{a.type === "asset" ? "Value" : "Balance"}</span>
          <input ref={amountRef} type="text" inputMode="decimal" class="num" value={amount.value} placeholder="0.00"
            onInput={(e) => (amount.value = e.currentTarget.value)} />
        </label>
      </div>
      {error.value && <p class="form-error" role="alert">{error.value}</p>}
      <div class="form-actions">
        <button type="submit" class="primary">Save {word}</button>
        <button type="button" onClick={props.onDone}>Done</button>
      </div>
      {a.valuations?.length ? (
        <ul class="valuation-list">
          {[...a.valuations].reverse().map((v) => (
            <li key={v.date}>
              <span>{shortDate(v.date)}</span>
              <span class="num">{formatCents(v.amount)}</span>
              <button type="button" class="icon-btn danger" aria-label={`Delete the ${word} on ${shortDate(v.date)}`}
                onClick={() => confirm(`Delete the ${formatCents(v.amount)} ${word} on ${shortDate(v.date)}?`)
                  && attempt((s) => deleteValuation(s, a.id, v.date), (m) => (error.value = m))}>
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </form>
  );
}

/**
 * Close an account on a day. What closing means depends on the account: an asset or investment
 * is worth nothing from then; any other account must already be at 0, its money moved by a transfer.
 */
function CloseForm(props: { account: Account; setup: YearSetup; onDone: () => void; onSaved: (id: string) => void }) {
  const { account: a, setup } = props;
  const date = useSignal(updateDay(setup));
  const error = useSignal<string | null>(null);

  async function onSubmit(e: Event) {
    e.preventDefault();
    if (await tryAction(() => setClosed(a.id, date.value), (m) => (error.value = m))) {
      props.onSaved(a.id);
      props.onDone();
    }
  }

  return (
    <form class="inline-form" onSubmit={onSubmit} onKeyDown={(e) => e.key === "Escape" && props.onDone()}>
      <p class="muted small">
        {hasValuations(a.type)
          ? <>From this day {a.name} counts for nothing in net worth, as when it's sold. Record what you got for it as an earning or a transfer into the account it went to.</>
          : <>{a.name} must be at $0.00 at the end of this day: move what's left with a transfer first. Nothing can be entered for it after.</>}
        {" "}It won't come into the next year. You can reopen it.
      </p>
      <div class="fields">
        <DateField label="Closed on" value={date.value} min={yearStart(setup)} max={updateDay(setup)} onChange={(d) => (date.value = d)} />
      </div>
      {error.value && <p class="form-error" role="alert">{error.value}</p>}
      <div class="form-actions">
        <button type="submit" class="primary">Close account</button>
        <button type="button" onClick={props.onDone}>Cancel</button>
      </div>
    </form>
  );
}

/** Cards and loans show what they owe rather than a balance. */
function owes(a: Account): boolean {
  return a.type === "credit" || a.type === "loan";
}

/** "6.5% a year · $300,000.00 from Mar 15, 2024". */
function loanText(a: Account): string {
  return `${a.rate}% a year · ${formatCents(a.loanAmount ?? 0)} from ${shortDate(a.loanStart!)}, ${a.loanStart!.slice(0, 4)}`;
}

/** A card or loan balance in plain words: −1234 -> "$12.34 owed". */
function owedText(balance: number): string {
  return balance < 0 ? `${formatCents(-balance)} owed` : balance > 0 ? `${formatCents(balance)} credit` : formatCents(0);
}

/**
 * The day the year's tracking starts. It saves on Save or Enter, not as you type: typing a
 * date passes through other valid dates on the way (the 2nd before the 21st), and each would
 * otherwise be saved.
 */
function StartField(props: { setup: YearSetup; onError: (msg: string | null) => void; onSaved: () => void }) {
  const saved = yearStart(props.setup);
  const draft = useSignal(saved);
  const changed = draft.value !== saved && draft.value !== "";

  async function save(e: Event) {
    e.preventDefault();
    if (!changed) return;
    // On success the field remounts with the new start (its key); on failure it goes back.
    if (await tryAction(() => setStart(draft.value), props.onError)) props.onSaved();
    else draft.value = saved;
  }

  return (
    <form class="start-field small" onSubmit={save}>
      <label>
        <span class="muted">Tracking starts</span>{" "}
        <input type="date" value={draft.value} min={`${props.setup.year}-01-01`} max={`${props.setup.year}-12-31`}
          disabled={readOnly.value} onInput={(e) => (draft.value = e.currentTarget.value)} />
      </label>
      {changed && (
        <>
          <button type="submit">Save</button>
          <button type="button" onClick={() => (draft.value = saved)}>Cancel</button>
        </>
      )}
    </form>
  );
}

/** "Balance on Jan 1", "Owed on Jul 14": what the opening field holds, on the day tracking starts. */
function openingLabel(isCard: boolean, isInvestment: boolean, setup: YearSetup): string {
  if (isInvestment) return "Opening (usually 0)";
  const day = shortDate(yearStart(setup));
  return isCard ? `Owed on ${day}` : `Balance on ${day}`;
}

function AccountForm(props: { account?: Account; first?: boolean; onDone: () => void; onSaved: (id: string) => void }) {
  const a = props.account;
  const name = useSignal(a?.name ?? "");
  const type = useSignal<AccountType>(a?.type ?? "checking");
  const ref = useSignal(a?.ref ?? "");
  // A card or loan opening is entered as the amount owed (positive) and stored negative.
  const opening = useSignal(a ? ((owes(a) ? -a.opening : a.opening) / 100).toFixed(2) : "");
  const limit = useSignal(a?.limit !== undefined ? (a.limit / 100).toFixed(2) : "");
  const loanStart = useSignal(a?.loanStart ?? "");
  const loanAmount = useSignal(a?.loanAmount !== undefined ? (a.loanAmount / 100).toFixed(2) : "");
  const rate = useSignal(a?.rate !== undefined ? String(a.rate) : "");
  const error = useSignal<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const setup = current.value!.setup;
  const isCard = type.value === "credit";
  const isLoan = type.value === "loan";
  // An asset has no opening balance. When adding one, the same box takes its value today, its first update.
  const isAsset = type.value === "asset";
  // Only a loan that began before tracking started has an amount owed to enter; a newer one is added on its start date.
  const loanBefore = isLoan && loanStart.value !== "" && loanStart.value < yearStart(setup);
  useEffect(() => nameRef.current?.focus(), []);

  async function onSubmit(e: Event) {
    e.preventDefault();
    const amount = opening.value.trim() === "" || (isLoan && !loanBefore) ? 0 : isAsset ? parseCents(opening.value) : parseSignedCents(opening.value);
    if (amount === null) {
      return void (error.value = isLoan ? "Enter what was owed, like 1234.56." : isAsset ? "Enter what it's worth, like 1234.56." : "Enter the opening balance like 1234.56.");
    }
    let loan: Pick<Account, "loanStart" | "loanAmount" | "rate"> = {};
    if (isLoan) {
      const borrowed = parseCents(loanAmount.value);
      if (borrowed === null) return void (error.value = "Enter the amount borrowed, like 250000.");
      if (!/^\d+(\.\d+)?$/.test(rate.value.trim())) return void (error.value = "Enter the yearly interest rate as a percentage, like 6.5.");
      loan = { loanStart: loanStart.value, loanAmount: borrowed, rate: Number(rate.value.trim()) };
    }
    let lim: number | undefined;
    if (isCard) {
      const l = parseCents(limit.value);
      if (l === null) return void (error.value = "Enter the card's credit limit, like 5000.");
      lim = l;
    }
    const account: Account = {
      id: a?.id ?? "", name: name.value, type: type.value, ref: ref.value,
      opening: isAsset ? 0 : isCard || isLoan ? -amount : amount,
      ...(lim !== undefined ? { limit: lim } : {}),
      ...loan,
      ...(a?.archived ? { archived: true } : {}),
      // Balance updates aren't in this form; they stay with the account.
      ...(a?.valuations ? { valuations: a.valuations } : {}),
      ...(a?.closedOn ? { closedOn: a.closedOn } : {}),
    };
    let id = a?.id ?? "";
    const ok = await attempt((s, u) => {
      const saved = saveAccount(s, account, u);
      id ||= saved.accounts.find((x) => !s.accounts.some((y) => y.id === x.id))!.id;
      if (!isAsset || a || opening.value.trim() === "") return saved;
      return saveValuation(saved, id, updateDay(s), amount);
    }, (m) => (error.value = m));
    if (!ok) return;
    props.onSaved(id);
    if (a) return props.onDone();
    // Ready for the next account.
    name.value = ""; ref.value = ""; opening.value = ""; limit.value = ""; loanStart.value = ""; loanAmount.value = ""; rate.value = "";
    nameRef.current?.focus();
  }

  return (
    <form class="inline-form" onSubmit={onSubmit} onKeyDown={(e) => e.key === "Escape" && props.onDone()}>
      {props.first && <p class="hint-box">Start by adding the accounts you track: bank accounts, cash, cards, investment accounts, loans and assets.</p>}
      <div class="fields">
        <label class="field w-item">
          <span class="field-label">Name</span>
          <input ref={nameRef} type="text" value={name.value} placeholder="e.g. Chase Checking"
            onInput={(e) => (name.value = e.currentTarget.value)} />
        </label>
        <label class="field w-account">
          <span class="field-label">Type</span>
          <select value={type.value} onChange={(e) => (type.value = e.currentTarget.value as AccountType)}>
            {(Object.keys(TYPE_LABEL) as AccountType[]).map((t) => <option value={t}>{TYPE_LABEL[t]}</option>)}
          </select>
        </label>
        <label class="field w-amount">
          <span class="field-label">Last 4 / handle</span>
          <input type="text" value={ref.value} placeholder="**1234" onInput={(e) => (ref.value = e.currentTarget.value)} />
        </label>
        {isLoan && (
          <>
            <label class="field w-date">
              <span class="field-label">Loan began</span>
              <input type="date" value={loanStart.value} max={`${setup.year}-12-31`}
                onInput={(e) => (loanStart.value = e.currentTarget.value)} />
            </label>
            <label class="field w-amount">
              <span class="field-label">Amount borrowed</span>
              <input type="text" inputMode="decimal" class="num" value={loanAmount.value} placeholder="0.00"
                onInput={(e) => (loanAmount.value = e.currentTarget.value)} />
            </label>
            <label class="field w-amount">
              <span class="field-label">Interest, % a year</span>
              <input type="text" inputMode="decimal" class="num" value={rate.value} placeholder="6.5"
                onInput={(e) => (rate.value = e.currentTarget.value)} />
            </label>
          </>
        )}
        {(isAsset ? !a : !isLoan || loanBefore) && (
          <label class="field w-account">
            <span class="field-label">{isAsset ? "Value today" : openingLabel(isCard || isLoan, type.value === "investment", setup)}</span>
            <input type="text" inputMode="decimal" class="num" value={opening.value} placeholder="0.00"
              onInput={(e) => (opening.value = e.currentTarget.value)} />
          </label>
        )}
        {isCard && (
          <label class="field w-amount">
            <span class="field-label">Credit limit</span>
            <input type="text" inputMode="decimal" class="num" value={limit.value} placeholder="0.00"
              onInput={(e) => (limit.value = e.currentTarget.value)} />
          </label>
        )}
      </div>
      {isLoan && (
        <p class="muted small">
          Each month on the day the loan began, the yearly rate ÷ 12 of what's still owed is added as interest.
          Record payments as transfers into the loan. What it owes comes off net worth.
        </p>
      )}
      {error.value && <p class="form-error" role="alert">{error.value}</p>}
      <div class="form-actions">
        <button type="submit" class="primary">{a ? "Save changes" : "Add account"}</button>
        <button type="button" onClick={props.onDone}>{a ? "Cancel" : "Done"}</button>
      </div>
    </form>
  );
}

// --- Categories ---

function CategoryCard({ kind, setup, usage }: { kind: CategoryKind; setup: YearSetup; usage: Usage }) {
  const error = useSignal<string | null>(null);
  const newName = useSignal("");
  const newRole = useSignal(kind === "expense" ? "" : Object.keys(ROLE_LABEL[kind])[0]!);
  const list = setup.categories[kind] as { id: string; name: string; role?: string; net?: boolean }[];
  const locked = readOnly.value;
  const fallback = uncategorizedId(setup, kind);
  const setError = (m: string | null) => (error.value = m);
  const saved = useSaved();

  async function add(e: Event) {
    e.preventDefault();
    const name = newName.value;
    if (await attempt((s) => saveCategory(s, kind, { id: "", name, role: newRole.value }), setError)) {
      newName.value = "";
      const id = idByName(current.value!.setup.categories[kind], name);
      if (id) saved.flash(id);
    }
  }

  async function remove(c: { id: string; name: string }) {
    const n = usage.categories.get(c.id) ?? 0;
    const moves = n ? ` Its ${n} ${n === 1 ? "entry moves" : "entries move"} to Uncategorized.` : "";
    if (confirm(`Delete “${c.name}”?${moves}`)) await tryAction(() => removeCategory(kind, c.id), setError);
  }

  return (
    <section class="card">
      <CardTitle title={KIND_TITLE[kind]}>{{
        expense: "Rename freely: entries keep their category. Delete one and its entries move to Uncategorized. Charity shows as a share of pay on the dashboard.",
        earning: "Tick “Net” for the earnings that make up net earnings on the dashboard; untick one-offs. “Lowers spending” is for refunds, points and money paid back: they lower net spending instead. “Transfer from external” is money from your own accounts outside the tracker: it counts in Earned, but not in net earnings. Uncategorized counts in neither.",
        transfer: "What each one is for drives the savings, investing, card-payment and loan-payment figures.",
      }[kind]}</CardTitle>
      <ul class={`name-list ${kind === "earning" ? "with-net" : ""}`}>
        {list.map((c) => (
          <li key={c.id}>
            <NameInput value={c.name} disabled={locked} label={`Rename ${c.name}`}
              onCommit={(name) => after(attempt((s) => saveCategory(s, kind, { ...c, name }), setError), () => saved.flash(c.id))} />
            {/* Uncategorized's role is fixed, so entries moved there stay out of the headline figures. */}
            <select value={c.role ?? ""} disabled={locked || c.id === fallback} aria-label={`What ${c.name} is for`}
              title={c.id === fallback ? "Fixed, so entries from deleted categories don't count as pay, savings or investing" : undefined}
              onChange={(e) => {
                // Read now: the change runs later, in turn with other saves, when the event no longer has a target.
                const role = e.currentTarget.value;
                after(attempt((s) => saveCategory(s, kind, { ...c, role }), setError), () => saved.flash(c.id));
              }}>
              {Object.entries(ROLE_LABEL[kind]).map(([role, label]) => <option value={role}>{label}</option>)}
            </select>
            {kind === "earning" && <NetTick cat={c} locked={locked || c.id === fallback} onChange={(net) => after(attempt((s) => saveCategory(s, kind, { ...c, net }), setError), () => saved.flash(c.id))} />}
            <span class="uses" title="Entries using it">{usage.categories.get(c.id) ?? 0}</span>
            {!locked && (c.id === fallback ? (
              <span class="del-placeholder" title="Entries from deleted categories go here, so it can't be deleted." />
            ) : (
              <button type="button" class="icon-btn danger" aria-label={`Delete ${c.name}`}
                title={usage.categories.get(c.id) ? "Delete; its entries move to Uncategorized" : "Delete (not used by any entry)"}
                onClick={() => remove(c)}>
                ×
              </button>
            ))}
            {saved.mark(c.id)}
          </li>
        ))}
      </ul>
      {!locked && (
        <form class="add-row" onSubmit={add}>
          <input type="text" value={newName.value} placeholder="New category" aria-label={`New ${kind} category`}
            onInput={(e) => (newName.value = e.currentTarget.value)} />
          <select value={newRole.value} onChange={(e) => (newRole.value = e.currentTarget.value)} aria-label="What it's for">
            {Object.entries(ROLE_LABEL[kind]).map(([role, label]) => <option value={role}>{label}</option>)}
          </select>
          <button type="submit" class="tinted add-earning">+ Add</button>
        </form>
      )}
      {error.value && <p class="form-error" role="alert">{error.value}</p>}
    </section>
  );
}

// --- Tags ---

function TagsCard({ tags, uses }: { tags: { id: string; name: string }[]; uses: Map<string, number> }) {
  const error = useSignal<string | null>(null);
  const newName = useSignal("");
  const locked = readOnly.value;
  const setError = (m: string | null) => (error.value = m);
  const saved = useSaved();

  async function add(e: Event) {
    e.preventDefault();
    const name = newName.value;
    if (await attempt((s) => saveTag(s, { id: "", name }), setError)) {
      newName.value = "";
      const id = idByName(current.value!.setup.tags, name);
      if (id) saved.flash(id);
    }
  }

  async function remove(t: { id: string; name: string }) {
    const n = uses.get(t.id) ?? 0;
    const off = n ? ` It comes off ${n === 1 ? "the 1 entry" : `the ${n} entries`} that ${n === 1 ? "has" : "have"} it.` : "";
    if (confirm(`Delete “${t.name}”?${off}`)) await tryAction(() => removeTag(t.id), setError);
  }

  return (
    <section class="card">
      <CardTitle title="Tags">
        Tags group expenses across categories, like “Costco” or “Vacation”. You can also add them while typing an
        expense. Deleting a tag takes it off its expenses.
      </CardTitle>
      {tags.length === 0 && <p class="muted small">None yet.</p>}
      <ul class="name-list compact">
        {tags.map((t) => (
          <li key={t.id}>
            <NameInput value={t.name} disabled={locked} label={`Rename ${t.name}`}
              onCommit={(name) => after(attempt((s) => saveTag(s, { id: t.id, name }), setError), () => saved.flash(t.id))} />
            <span class="uses" title="Entries using it">{uses.get(t.id) ?? 0}</span>
            {!locked && (
              <button type="button" class="icon-btn danger" aria-label={`Delete ${t.name}`}
                title={uses.get(t.id) ? "Delete; it comes off the entries that have it" : "Delete (not used by any entry)"}
                onClick={() => remove(t)}>
                ×
              </button>
            )}
            {saved.mark(t.id)}
          </li>
        ))}
      </ul>
      {!locked && (
        <form class="add-row" onSubmit={add}>
          <input type="text" value={newName.value} placeholder="New tag" aria-label="New tag"
            onInput={(e) => (newName.value = e.currentTarget.value)} />
          <button type="submit" class="tinted add-earning">+ Add</button>
        </form>
      )}
      {error.value && <p class="form-error" role="alert">{error.value}</p>}
    </section>
  );
}

// --- People ---

function PeopleCard({ setup, usage }: { setup: YearSetup; usage: Usage }) {
  const error = useSignal<string | null>(null);
  const newName = useSignal("");
  const locked = readOnly.value;
  const members = membersOf(setup);
  const first = members[0]!;
  const setError = (m: string | null) => (error.value = m);
  const saved = useSaved();

  async function add(e: Event) {
    e.preventDefault();
    const name = newName.value;
    if (await attempt((s) => saveMember(s, { id: "", name }), setError)) {
      newName.value = "";
      const id = idByName(membersOf(current.value!.setup), name);
      if (id) saved.flash(id);
    }
  }

  async function remove(m: { id: string; name: string }) {
    const n = memberUses(setup, usage, m.id);
    const moves = n ? ` ${n === 1 ? "Their 1 entry moves" : `Their ${n} entries move`} to ${first.name}.` : "";
    if (confirm(`Delete “${m.name}”?${moves}`)) await tryAction(() => removeMember(m.id), setError);
  }

  return (
    <section class="card">
      <CardTitle title="People">
        Everything belongs to {first.name} until you add someone else. Then each entry can be logged for one person,
        and the Dashboard, Ledger and Reports can show one person at a time. Accounts and budgets stay shared.
      </CardTitle>
      <ul class="name-list compact">
        {members.map((m) => (
          <li key={m.id}>
            <NameInput value={m.name} disabled={locked} label={`Rename ${m.name}`}
              onCommit={(name) => after(attempt((s) => saveMember(s, { id: m.id, name }), setError), () => saved.flash(m.id))} />
            <span class="uses" title="Entries for them">{memberUses(setup, usage, m.id)}</span>
            {!locked && (m.id === first.id ? (
              <span class="del-placeholder" title="The default person: new entries are theirs unless you pick someone else. Rename instead." />
            ) : (
              <button type="button" class="icon-btn danger" aria-label={`Delete ${m.name}`}
                title={`Delete; their entries move to ${first.name}`} onClick={() => remove(m)}>
                ×
              </button>
            ))}
            {saved.mark(m.id)}
          </li>
        ))}
      </ul>
      {!locked && (
        <form class="add-row" onSubmit={add}>
          <input type="text" value={newName.value} placeholder="New person" aria-label="New person"
            onInput={(e) => (newName.value = e.currentTarget.value)} />
          <button type="submit" class="tinted add-earning">+ Add</button>
        </form>
      )}
      {error.value && <p class="form-error" role="alert">{error.value}</p>}
    </section>
  );
}

/** "Counts in net earnings", for paycheck and income categories; others can't count. */
function NetTick(props: { cat: { name: string; role?: string; net?: boolean }; locked: boolean; onChange: (net: boolean) => void }) {
  const eligible = props.cat.role === "paycheck" || props.cat.role === "income";
  return (
    <label class="net-tick" title={eligible ? "Ticked: counts in net earnings. Unticked: counts in neither net earnings nor net spending."
      : props.cat.role === "transfer_in" ? "Money from your own accounts elsewhere: it counts in Earned, never in net earnings"
      : "Refunds, points and paybacks lower net spending, so they never count as earnings"}>
      <input type="checkbox" checked={eligible && countsInNetEarnings(props.cat as { role?: EarningRole; net?: boolean })}
        disabled={props.locked || !eligible} aria-label={`${props.cat.name} counts in net earnings`}
        onChange={(e) => props.onChange(e.currentTarget.checked)} />
      <span>Net</span>
    </label>
  );
}

/** Rename in place: saves on Enter or when you leave the box; Esc puts the old name back. */
function NameInput(props: { value: string; label: string; disabled: boolean; onCommit: (name: string) => Promise<boolean> }) {
  async function commit(input: HTMLInputElement) {
    const name = input.value.trim();
    if (name === props.value) return;
    if (!(await props.onCommit(name))) input.value = props.value;
  }
  return (
    <input type="text" class="name-input" key={props.value} defaultValue={props.value} aria-label={props.label}
      disabled={props.disabled}
      onKeyDown={(e) => {
        if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); }
        if (e.key === "Escape") { e.currentTarget.value = props.value; e.currentTarget.blur(); }
      }}
      onBlur={(e) => commit(e.currentTarget)} />
  );
}
