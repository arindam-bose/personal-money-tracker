// The add/edit form for expenses, earnings and transfers.
// Built for the keyboard: fields in typing order, Enter saves, Esc closes.

import { useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import type { JSX } from "preact";
import {
  checkDraft, earningRole, suggestTransferCategory,
  type AnyEntry, type Draft, type DraftErrors, type DraftField, type Kind,
} from "../entries";
import { current, ensurePerson, ensureTag, nextEntryId, removeEntry, saveEntry } from "../state";
import type { Account, YearSetup } from "../types";

const KIND_LABEL: Record<Kind, string> = { expense: "Expense", earning: "Earning", transfer: "Transfer" };

interface Props {
  initial: Draft;
  /** Called after a save or delete, and on Cancel/Esc. */
  onClose: () => void;
}

export function EntryForm({ initial, onClose }: Props) {
  const setup = current.value!.setup;
  const draft = useSignal<Draft>(initial);
  const errors = useSignal<DraftErrors>({});
  const tried = useSignal(false); // show errors only after the first save attempt
  const saved = useSignal<string | null>(null);
  // The transfer category follows the accounts until the user picks one themselves.
  const catPicked = useSignal(initial.id !== undefined);
  const owedName = useSignal(personName(setup, initial.owedPerson));
  const personText = useSignal(personName(setup, initial.person));
  const itemRef = useRef<HTMLInputElement>(null);
  const editing = initial.id !== undefined;
  const d = draft.value;

  useEffect(() => itemRef.current?.focus(), []);

  function set<K extends DraftField>(field: K, value: Draft[K]) {
    let next = { ...draft.value, [field]: value };
    if (next.kind === "transfer" && !catPicked.value && (field === "from" || field === "to" || field === "kind")) {
      const byId = (id: string) => setup.accounts.find((a) => a.id === id);
      next = { ...next, cat: suggestTransferCategory(byId(next.from), byId(next.to), setup) ?? "" };
    }
    draft.value = next;
    saved.value = null;
    if (tried.value) errors.value = check(next).errors;
  }

  function switchKind(kind: Kind) {
    if (kind === draft.value.kind) return;
    // Categories differ per kind; carry over the account sensibly.
    const old = draft.value;
    draft.value = {
      ...old, kind, cat: "",
      from: kind === "transfer" ? old.from || old.account : old.from,
      account: kind !== "transfer" ? old.account || old.from : old.account,
    };
    catPicked.value = false;
    set("kind", kind);
  }

  function check(dr: Draft): { ok: boolean; errors: DraftErrors; entry?: AnyEntry } {
    const id = dr.id ?? "pending";
    const r = checkDraft(dr, setup, id);
    return r.ok ? { ok: true, errors: {}, entry: r.entry } : { ok: false, errors: r.errors };
  }

  async function onSubmit(e: Event) {
    e.preventDefault();
    tried.value = true;
    let dr = draft.value;
    // People are typed by name; add anyone new before checking.
    if (dr.kind === "expense") dr = { ...dr, owedPerson: owedName.value.trim() ? await ensurePerson(owedName.value) : "" };
    if (dr.kind === "earning" && earningRole(dr, setup) === "reimbursement" && personText.value.trim()) {
      dr = { ...dr, person: await ensurePerson(personText.value) };
    }
    const r = checkDraft(dr, current.value!.setup, dr.id ?? nextEntryId(dr.kind));
    if (!r.ok) {
      draft.value = dr;
      errors.value = r.errors;
      return;
    }
    await saveEntry(r.entry, editing ? initial.kind : undefined);
    if (editing) return onClose();
    // Ready for the next entry: keep kind, date and accounts, clear the rest.
    draft.value = { ...dr, item: "", amount: "", notes: "", tags: [], owedPerson: "", owedAmount: "", offsets: "", person: "",
      cat: dr.kind === "transfer" ? dr.cat : "" };
    owedName.value = "";
    personText.value = "";
    tried.value = false;
    errors.value = {};
    saved.value = `Saved “${r.entry.entry.item}”.`;
    itemRef.current?.focus();
  }

  async function onDelete() {
    if (!initial.id || !confirm(`Delete “${initial.item}”? This can't be undone.`)) return;
    await removeEntry(initial.kind, initial.id);
    onClose();
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "Enter" && (e.target as HTMLElement).tagName === "SELECT") {
      // Enter in a dropdown saves too (browsers only do this for text fields).
      e.preventDefault();
      (e.currentTarget as HTMLFormElement).requestSubmit();
    }
  }

  const err = errors.value;
  const accounts = setup.accounts.filter((a) => !a.archived || [d.account, d.from, d.to].includes(a.id));
  const role = earningRole(d, setup);

  return (
    <form class={`entry-form kind-${d.kind}`} onSubmit={onSubmit} onKeyDown={onKeyDown} noValidate>
      <div class="kind-tabs" role="tablist">
        {(["expense", "earning", "transfer"] as Kind[]).map((k) => (
          <button type="button" role="tab" aria-selected={d.kind === k} class={d.kind === k ? "active" : ""} onClick={() => switchKind(k)}>
            {KIND_LABEL[k]}
          </button>
        ))}
        <span class="muted hint">{editing ? "Editing" : "New"} · Enter saves · Esc closes</span>
      </div>

      <div class="fields">
        <Field label="Date" error={err.date} class="w-date">
          <input type="date" value={d.date} min={`${setup.year}-01-01`} max={`${setup.year}-12-31`}
            onInput={(e) => set("date", e.currentTarget.value)} />
        </Field>
        <Field label="Item" error={err.item} class="w-item">
          <input ref={itemRef} type="text" value={d.item} placeholder="What was it?"
            onInput={(e) => set("item", e.currentTarget.value)} />
        </Field>
        <Field label="Amount" error={err.amount} class="w-amount">
          <input type="text" inputMode="decimal" value={d.amount} placeholder="0.00" class="num"
            onInput={(e) => set("amount", e.currentTarget.value)} />
        </Field>

        {d.kind === "transfer" ? (
          <>
            <Field label="From" error={err.from} class="w-account">
              <AccountSelect accounts={accounts} value={d.from} onChange={(v) => set("from", v)} />
            </Field>
            <Field label="To" error={err.to} class="w-account">
              <AccountSelect accounts={accounts} value={d.to} onChange={(v) => set("to", v)} />
            </Field>
          </>
        ) : (
          <Field label={d.kind === "expense" ? "Paid from" : "Paid into"} error={err.account} class="w-account">
            <AccountSelect accounts={accounts} value={d.account} onChange={(v) => set("account", v)} />
          </Field>
        )}

        <Field label="Category" error={err.cat} class="w-cat">
          <select value={d.cat} onChange={(e) => { catPicked.value = true; set("cat", e.currentTarget.value); }}>
            <option value="">Choose…</option>
            {setup.categories[d.kind].map((c) => <option value={c.id}>{c.name}</option>)}
          </select>
        </Field>
      </div>

      {d.kind === "expense" && (
        <div class="fields">
          <Field label="Tags" error={err.tags} class="w-tags">
            <TagPicker setup={setup} value={d.tags} onChange={(tags) => set("tags", tags)} />
          </Field>
          <Field label="Someone owes me part" error={err.owedPerson} class="w-person">
            <PersonInput setup={setup} value={owedName.value} placeholder="Nobody"
              onInput={(v) => { owedName.value = v; saved.value = null; }} />
          </Field>
          {owedName.value.trim() && (
            <Field label="Their share" error={err.owedAmount} class="w-amount">
              <input type="text" inputMode="decimal" value={d.owedAmount} placeholder="0.00" class="num"
                onInput={(e) => set("owedAmount", e.currentTarget.value)} />
            </Field>
          )}
        </div>
      )}

      {role === "offset" && (
        <div class="fields">
          <Field label="Reduces spending on" error={err.offsets} class="w-cat">
            <select value={d.offsets} onChange={(e) => set("offsets", e.currentTarget.value)}>
              <option value="">All spending</option>
              {setup.categories.expense.map((c) => <option value={c.id}>{c.name}</option>)}
            </select>
          </Field>
        </div>
      )}
      {role === "reimbursement" && (
        <div class="fields">
          <Field label="Paid back by" error={err.person} class="w-person">
            <PersonInput setup={setup} value={personText.value} placeholder="Who?"
              onInput={(v) => { personText.value = v; saved.value = null; }} />
          </Field>
        </div>
      )}

      <div class="fields">
        <Field label="Notes" class="w-notes">
          <input type="text" value={d.notes} onInput={(e) => set("notes", e.currentTarget.value)} />
        </Field>
      </div>

      <div class="form-actions">
        <button type="submit" class="primary">{editing ? "Save changes" : `Add ${KIND_LABEL[d.kind].toLowerCase()}`}</button>
        <button type="button" onClick={onClose}>{editing ? "Cancel" : "Close"}</button>
        {editing && <button type="button" class="danger" onClick={onDelete}>Delete</button>}
        {saved.value && <span class="saved" role="status">{saved.value}</span>}
      </div>
    </form>
  );
}

function personName(setup: YearSetup, id: string): string {
  return setup.people?.find((p) => p.id === id)?.name ?? "";
}

function Field(props: { label: string; error?: string; class?: string; children: JSX.Element | JSX.Element[] }) {
  return (
    <label class={`field ${props.class ?? ""} ${props.error ? "has-error" : ""}`}>
      <span class="field-label">{props.label}</span>
      {props.children}
      {props.error && <span class="field-error">{props.error}</span>}
    </label>
  );
}

const TYPE_LABEL: Record<Account["type"], string> = {
  checking: "Bank", savings: "Savings", cash: "Cash", credit: "Credit cards", investment: "Investments",
};

function AccountSelect(props: { accounts: Account[]; value: string; onChange: (id: string) => void }) {
  const groups = (Object.keys(TYPE_LABEL) as Account["type"][])
    .map((type) => [type, props.accounts.filter((a) => a.type === type)] as const)
    .filter(([, list]) => list.length);
  return (
    <select value={props.value} onChange={(e) => props.onChange(e.currentTarget.value)}>
      <option value="">Choose…</option>
      {groups.map(([type, list]) => (
        <optgroup label={TYPE_LABEL[type]}>
          {list.map((a) => <option value={a.id}>{a.name}</option>)}
        </optgroup>
      ))}
    </select>
  );
}

/** Pick from known people by typing; a new name is added when the entry is saved. */
function PersonInput(props: { setup: YearSetup; value: string; placeholder: string; onInput: (v: string) => void }) {
  return (
    <>
      <input type="text" list="people-list" value={props.value} placeholder={props.placeholder}
        onInput={(e) => props.onInput(e.currentTarget.value)} />
      <datalist id="people-list">
        {(props.setup.people ?? []).map((p) => <option value={p.name} />)}
      </datalist>
    </>
  );
}

/**
 * Chosen tags as chips, plus a box to add more. Type a name and press Enter or comma:
 * an existing tag is added, a new name creates the tag. Backspace in the empty box
 * removes the last chip.
 */
function TagPicker(props: { setup: YearSetup; value: string[]; onChange: (ids: string[]) => void }) {
  const text = useSignal("");
  const names = new Map(props.setup.tags.map((t) => [t.id, t.name]));

  async function add() {
    const name = text.value.trim();
    if (!name) return;
    const id = await ensureTag(name);
    if (!props.value.includes(id)) props.onChange([...props.value, id]);
    text.value = "";
  }

  function onKeyDown(e: KeyboardEvent) {
    if ((e.key === "Enter" || e.key === ",") && text.value.trim()) {
      e.preventDefault();
      e.stopPropagation();
      add();
    } else if (e.key === "Backspace" && !text.value && props.value.length) {
      props.onChange(props.value.slice(0, -1));
    }
  }

  return (
    <div class="tag-picker">
      {props.value.map((id) => (
        <span class="chip">
          {names.get(id) ?? id}
          <button type="button" aria-label={`Remove ${names.get(id) ?? id}`} onClick={() => props.onChange(props.value.filter((t) => t !== id))}>×</button>
        </span>
      ))}
      <input type="text" list="tag-list" value={text.value} placeholder={props.value.length ? "" : "Add tags…"}
        onInput={(e) => (text.value = e.currentTarget.value)} onKeyDown={onKeyDown} />
      <datalist id="tag-list">
        {props.setup.tags.filter((t) => !props.value.includes(t.id)).map((t) => <option value={t.name} />)}
      </datalist>
    </div>
  );
}
