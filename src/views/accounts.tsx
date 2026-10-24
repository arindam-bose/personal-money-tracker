// Accounts: set up the year's accounts, categories, tags and people (brief §8, view 5).
// Everything is referenced by id, so renaming here never breaks an entry.

import { useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { balances, countsInNetEarnings } from "../derive";
import { formatCents, parseCents, parseSignedCents } from "../money";
import {
  deleteAccount, deletePerson, duplicateAccount, saveAccount, saveCategory, savePerson, saveTag,
  uncategorizedId, usageOf, type CategoryKind, type Usage,
} from "../setup";
import { current, ledger, readOnly, removeCategory, removeTag, updateSetup } from "../state";
import type { Account, AccountType, EarningRole, YearSetup } from "../types";

const TYPE_LABEL: Record<AccountType, string> = {
  checking: "Checking", savings: "Savings", cash: "Cash", credit: "Credit card", investment: "Investment",
};

/** Plain-language names for the roles that drive the reports. */
const ROLE_LABEL: Record<CategoryKind, Record<string, string>> = {
  expense: { "": "Regular", charity: "Charity", loan: "Loan payment" },
  earning: {
    paycheck: "Paycheck", income: "Other income", offset: "Lowers spending",
    reimbursement: "Paid back",
  },
  transfer: {
    cc_payment: "Card payment", savings_in: "Into savings", savings_out: "Out of savings",
    invest_retirement: "Retirement investing", invest_taxable: "Taxable investing",
    cash_withdrawal: "Cash withdrawal", general: "Other move",
  },
};

const KIND_TITLE: Record<CategoryKind, string> = { expense: "Expense categories", earning: "Earning categories", transfer: "Transfer categories" };

/** Run a setup change and turn a SetupError into a message for the user. */
async function attempt(change: (s: YearSetup, u: Usage) => YearSetup, onError: (msg: string | null) => void): Promise<boolean> {
  try {
    await updateSetup(change);
    onError(null);
    return true;
  } catch (e) {
    // SetupError explains what to fix; anything else (e.g. a closed year) still has a readable message.
    onError(e instanceof Error ? e.message : String(e));
    return false;
  }
}

export function AccountsView() {
  const data = current.value;
  if (!data) {
    return (
      <section class="panel">
        <h2>Accounts</h2>
        <p>No year yet. Go to <a href="#/data">Data</a> to import a file or start from scratch.</p>
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
      <NamesCard title="Tags" what="tag" items={data.setup.tags} uses={usage.tags}
          save={(id, name) => (s) => saveTag(s, { id, name })} removeAny={removeTag}
          hint="Tags group expenses across categories, like “Costco” or “Vacation”. You can also add them while typing an expense. Deleting a tag takes it off its expenses." />
        <NamesCard title="People" what="person" items={data.setup.people ?? []} uses={usage.people}
          save={(id, name) => (s) => savePerson(s, { id, name })} remove={(id) => (s, u) => deletePerson(s, id, u)}
          hint="People who share expenses with you or pay you back." />
    </div>
  );
}

// --- Accounts ---

function AccountsCard({ setup, usage }: { setup: YearSetup; usage: Usage }) {
  /** The account being added ("new") or edited (its id); null when the form is closed. */
  const editing = useSignal<string | null>(setup.accounts.length === 0 && !readOnly.value ? "new" : null);
  const error = useSignal<string | null>(null);
  const bal = balances(ledger.value!);
  const sorted = [...setup.accounts].sort((a, b) => Number(!!a.archived) - Number(!!b.archived));

  async function toggleArchive(a: Account) {
    await attempt((s) => saveAccount(s, { ...a, archived: !a.archived }), (m) => (error.value = m));
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
          <h3>Accounts</h3>
          <p class="muted small">Opening balances are what each account held on January 1, {setup.year}.</p>
        </div>
        {!readOnly.value && editing.value === null && (
          <button type="button" onClick={() => (editing.value = "new")}>+ Add account</button>
        )}
      </div>

      {editing.value === "new" && (
        <AccountForm onDone={() => (editing.value = null)} first={setup.accounts.length === 0} />
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
              <tr key={a.id}><td colSpan={8}><AccountForm account={a} onDone={() => (editing.value = null)} /></td></tr>
            ) : (
              <tr key={a.id} class={a.archived ? "archived" : ""}>
                <td>{a.name}{a.archived && <span class="badge">archived</span>}</td>
                <td>{TYPE_LABEL[a.type]}</td>
                <td>{a.ref}</td>
                <td class="num">{a.type === "credit" ? owedText(a.opening) : formatCents(a.opening)}</td>
                <td class="num">{a.limit !== undefined ? formatCents(a.limit) : ""}</td>
                <td class="num">{a.type === "credit" ? owedText(bal.get(a.id) ?? 0) : formatCents(bal.get(a.id) ?? 0)}</td>
                <td class="num">{usage.accounts.get(a.id) ?? 0}</td>
                <td>
                  {!readOnly.value && (
                    <div class="row-actions">
                      <button type="button" onClick={() => (editing.value = a.id)}>Edit</button>
                      <button type="button" onClick={() => copy(a)} title={`Add a copy named “${a.name}_new”`}>Duplicate</button>
                      <button type="button" onClick={() => toggleArchive(a)}
                        title={a.archived ? "Show it again for new entries" : "Hide it from new entries; old entries keep it"}>
                        {a.archived ? "Unarchive" : "Archive"}
                      </button>
                      {!usage.accounts.get(a.id) && <button type="button" class="danger" onClick={() => remove(a)}>Delete</button>}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

/** A card balance in plain words: −1234 -> "$12.34 owed". */
function owedText(balance: number): string {
  return balance < 0 ? `${formatCents(-balance)} owed` : balance > 0 ? `${formatCents(balance)} credit` : formatCents(0);
}

function AccountForm(props: { account?: Account; first?: boolean; onDone: () => void }) {
  const a = props.account;
  const name = useSignal(a?.name ?? "");
  const type = useSignal<AccountType>(a?.type ?? "checking");
  const ref = useSignal(a?.ref ?? "");
  // A card's opening is entered as the amount owed (positive) and stored negative.
  const opening = useSignal(a ? ((a.type === "credit" ? -a.opening : a.opening) / 100).toFixed(2) : "");
  const limit = useSignal(a?.limit !== undefined ? (a.limit / 100).toFixed(2) : "");
  const error = useSignal<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const isCard = type.value === "credit";
  useEffect(() => nameRef.current?.focus(), []);

  async function onSubmit(e: Event) {
    e.preventDefault();
    const amount = opening.value.trim() === "" ? 0 : parseSignedCents(opening.value);
    if (amount === null) return void (error.value = "Enter the opening balance like 1234.56.");
    let lim: number | undefined;
    if (isCard) {
      const l = parseCents(limit.value);
      if (l === null) return void (error.value = "Enter the card's credit limit, like 5000.");
      lim = l;
    }
    const account: Account = {
      id: a?.id ?? "", name: name.value, type: type.value, ref: ref.value,
      opening: isCard ? -amount : amount,
      ...(lim !== undefined ? { limit: lim } : {}),
      ...(a?.archived ? { archived: true } : {}),
    };
    const ok = await attempt((s) => saveAccount(s, account), (m) => (error.value = m));
    if (!ok) return;
    if (a) return props.onDone();
    // Ready for the next account.
    name.value = ""; ref.value = ""; opening.value = ""; limit.value = "";
    nameRef.current?.focus();
  }

  return (
    <form class="inline-form" onSubmit={onSubmit} onKeyDown={(e) => e.key === "Escape" && props.onDone()}>
      {props.first && <p class="hint-box">Start by adding the accounts you track: bank accounts, cash, cards and investment accounts.</p>}
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
        <label class="field w-account">
          <span class="field-label">{isCard ? "Owed at start of year" : type.value === "investment" ? "Opening (usually 0)" : "Balance at start of year"}</span>
          <input type="text" inputMode="decimal" class="num" value={opening.value} placeholder="0.00"
            onInput={(e) => (opening.value = e.currentTarget.value)} />
        </label>
        {isCard && (
          <label class="field w-amount">
            <span class="field-label">Credit limit</span>
            <input type="text" inputMode="decimal" class="num" value={limit.value} placeholder="0.00"
              onInput={(e) => (limit.value = e.currentTarget.value)} />
          </label>
        )}
      </div>
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

  async function add(e: Event) {
    e.preventDefault();
    if (await attempt((s) => saveCategory(s, kind, { id: "", name: newName.value, role: newRole.value }), setError)) newName.value = "";
  }

  async function remove(c: { id: string; name: string }) {
    const n = usage.categories.get(c.id) ?? 0;
    const moves = n ? ` Its ${n} ${n === 1 ? "entry moves" : "entries move"} to Uncategorized.` : "";
    if (!confirm(`Delete “${c.name}”?${moves}`)) return;
    try {
      await removeCategory(kind, c.id);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <section class="card">
      <h3>{KIND_TITLE[kind]}</h3>
      <p class="muted small">{{
        expense: "Rename freely: entries keep their category. Delete one and its entries move to Uncategorized. Charity shows as a share of pay on the dashboard.",
        earning: "“Lowers spending” is for refunds and points. “Paid back” is someone settling what they owe you. Tick “Net” for the earnings that make up net earnings on the dashboard; untick one-offs.",
        transfer: "What each one is for drives the savings, investing and card-payment figures.",
      }[kind]}</p>
      <ul class={`name-list ${kind === "earning" ? "with-net" : ""}`}>
        {list.map((c) => (
          <li key={c.id}>
            <NameInput value={c.name} disabled={locked} label={`Rename ${c.name}`}
              onCommit={(name) => attempt((s) => saveCategory(s, kind, { ...c, name }), setError)} />
            <select value={c.role ?? ""} disabled={locked} aria-label={`What ${c.name} is for`}
              onChange={(e) => attempt((s) => saveCategory(s, kind, { ...c, role: e.currentTarget.value }), setError)}>
              {Object.entries(ROLE_LABEL[kind]).map(([role, label]) => <option value={role}>{label}</option>)}
            </select>
            {kind === "earning" && <NetTick cat={c} locked={locked} onChange={(net) => attempt((s) => saveCategory(s, kind, { ...c, net }), setError)} />}
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
          <button type="submit">Add</button>
        </form>
      )}
      {error.value && <p class="form-error" role="alert">{error.value}</p>}
    </section>
  );
}

// --- Tags and people ---

function NamesCard(props: {
  title: string;
  what: string;
  items: { id: string; name: string }[];
  uses: Map<string, number>;
  save: (id: string, name: string) => (s: YearSetup, u: Usage) => YearSetup;
  /** Delete an unused item. */
  remove?: (id: string) => (s: YearSetup, u: Usage) => YearSetup;
  /** Delete an item even when entries use it (it comes off them). Takes the place of `remove`. */
  removeAny?: (id: string) => Promise<void>;
  hint: string;
}) {
  const error = useSignal<string | null>(null);
  const newName = useSignal("");
  const locked = readOnly.value;
  const setError = (m: string | null) => (error.value = m);

  async function add(e: Event) {
    e.preventDefault();
    if (await attempt(props.save("", newName.value), setError)) newName.value = "";
  }

  async function removeAny(x: { id: string; name: string }, run: (id: string) => Promise<void>) {
    const n = props.uses.get(x.id) ?? 0;
    const off = n ? ` It comes off ${n === 1 ? "the 1 entry" : `the ${n} entries`} that ${n === 1 ? "has" : "have"} it.` : "";
    if (!confirm(`Delete “${x.name}”?${off}`)) return;
    try {
      await run(x.id);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <section class="card">
      <h3>{props.title}</h3>
      <p class="muted small">{props.hint}</p>
      {props.items.length === 0 && <p class="muted small">None yet.</p>}
      <ul class="name-list compact">
        {props.items.map((x) => (
          <li key={x.id}>
            <NameInput value={x.name} disabled={locked} label={`Rename ${x.name}`}
              onCommit={(name) => attempt(props.save(x.id, name), setError)} />
            <span class="uses" title="Entries using it">{props.uses.get(x.id) ?? 0}</span>
            {!locked && (props.removeAny ? (
              <button type="button" class="icon-btn danger" aria-label={`Delete ${x.name}`}
                title={props.uses.get(x.id) ? `Delete; it comes off the entries that have it` : "Delete (not used by any entry)"}
                onClick={() => removeAny(x, props.removeAny!)}>
                ×
              </button>
            ) : props.remove && (
              <DeleteButton used={props.uses.get(x.id) ?? 0} name={x.name}
                onDelete={() => attempt(props.remove!(x.id), setError)} />
            ))}
          </li>
        ))}
      </ul>
      {!locked && (
        <form class="add-row" onSubmit={add}>
          <input type="text" value={newName.value} placeholder={`New ${props.what}`} aria-label={`New ${props.what}`}
            onInput={(e) => (newName.value = e.currentTarget.value)} />
          <button type="submit">Add</button>
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
    <label class="net-tick" title={eligible ? "Counts in net earnings" : "Refunds and paybacks aren't earnings, so they never count"}>
      <input type="checkbox" checked={eligible && countsInNetEarnings(props.cat as { role?: EarningRole; net?: boolean })}
        disabled={props.locked || !eligible} aria-label={`${props.cat.name} counts in net earnings`}
        onChange={(e) => props.onChange(e.currentTarget.checked)} />
      <span>Net</span>
    </label>
  );
}

/** Delete is offered only for unused items; used ones explain why it isn't there. */
function DeleteButton(props: { used: number; name: string; onDelete: () => void }) {
  if (props.used) return <span class="del-placeholder" title="In use, so it can't be deleted. Rename it instead." />;
  return (
    <button type="button" class="icon-btn danger" aria-label={`Delete ${props.name}`} title="Delete (not used by any entry)"
      onClick={() => confirm(`Delete “${props.name}”?`) && props.onDelete()}>
      ×
    </button>
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
