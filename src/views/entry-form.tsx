// The add/edit form for expenses, earnings and transfers.
// Built for the keyboard: fields in typing order, Enter saves, Esc closes.

import { useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import type { JSX } from "preact";
import {
  checkDraft, defaultCategory, earningRole, suggestTransferCategory, tidyAmount,
  type AnyEntry, type Draft, type DraftErrors, type DraftField, type Kind,
} from "../entries";
import { membersOf } from "../setup";
import { current, ensureTag, nextEntryId, removeEntry, saveEntry } from "../state";
import type { Account, YearSetup } from "../types";
import { yearStart } from "../year";
import { DateField } from "./date-field";
import { SearchSelect, matching } from "./search-select";

const KIND_LABEL: Record<Kind, string> = { earning: "Earning", expense: "Expense", transfer: "Transfer" };

interface Props {
  initial: Draft;
  /** Called after a save or delete, and on Cancel/Esc. */
  onClose: () => void;
}

export function EntryForm({ initial, onClose }: Props) {
  const setup = current.value!.setup;
  const members = membersOf(setup);
  const draft = useSignal<Draft>(initial);
  const errors = useSignal<DraftErrors>({});
  const tried = useSignal(false); // show errors only after the first save attempt
  const saved = useSignal<string | null>(null);
  /** Why the last save or delete was refused (say, it would change a closed account), or null. */
  const failed = useSignal<string | null>(null);
  // The transfer category follows the accounts until the user picks one themselves.
  const catPicked = useSignal(initial.id !== undefined);
  const itemRef = useRef<HTMLInputElement>(null);
  const editing = initial.id !== undefined;
  const d = draft.value;
  const defaultCat = (kind: Kind) => defaultCategory(setup, kind);

  useEffect(() => itemRef.current?.focus(), []);

  function set<K extends DraftField>(field: K, value: Draft[K]) {
    let next = { ...draft.value, [field]: value };
    if (next.kind === "transfer" && !catPicked.value && (field === "from" || field === "to" || field === "kind")) {
      const byId = (id: string) => setup.accounts.find((a) => a.id === id);
      next = { ...next, cat: suggestTransferCategory(byId(next.from), byId(next.to), setup) ?? defaultCat("transfer") };
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
      ...old, kind, cat: defaultCat(kind),
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
    const dr = draft.value;
    const r = checkDraft(dr, current.value!.setup, dr.id ?? nextEntryId(dr.kind));
    if (!r.ok) {
      draft.value = dr;
      errors.value = r.errors;
      return;
    }
    if (!(await attemptStore(() => saveEntry(r.entry, editing ? initial.kind : undefined)))) return;
    if (editing) return onClose();
    // Ready for the next entry: keep kind, date and accounts, clear the rest.
    draft.value = { ...dr, item: "", amount: "", notes: "", tags: [], offsets: "",
      cat: dr.kind === "transfer" ? dr.cat : defaultCat(dr.kind) };
    tried.value = false;
    errors.value = {};
    saved.value = `Saved “${r.entry.entry.item}”.`;
    itemRef.current?.focus();
  }

  async function onDelete() {
    if (!initial.id || !confirm(`Delete “${initial.item}”? This can't be undone.`)) return;
    if (await attemptStore(() => removeEntry(initial.kind, initial.id!))) onClose();
  }

  /** Run a save or delete; a refusal shows under the buttons. True if it worked. */
  async function attemptStore(run: () => Promise<void>): Promise<boolean> {
    try {
      await run();
      failed.value = null;
      return true;
    } catch (err) {
      failed.value = err instanceof Error ? err.message : String(err);
      return false;
    }
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "Enter" && (e.target as HTMLElement).tagName === "SELECT") {
      // Enter in a dropdown saves too (browsers only do this for text fields; SearchSelect does it itself).
      e.preventDefault();
      (e.currentTarget as HTMLFormElement).requestSubmit();
    }
  }

  const err = errors.value;
  // Assets never take entries: their value only changes by updating it on the Accounts page.
  // A closed account, like an archived one, only stays on the entries that already use it.
  const accounts = setup.accounts.filter((a) => a.type !== "asset" && (!(a.archived || a.closedOn) || [d.account, d.from, d.to].includes(a.id)));
  const role = earningRole(d, setup);

  return (
    <form class={`entry-form kind-${d.kind}`} onSubmit={onSubmit} onKeyDown={onKeyDown} noValidate>
      <div class="kind-tabs" role="tablist">
        {(["earning", "expense", "transfer"] as Kind[]).map((k) => (
          <button type="button" role="tab" aria-selected={d.kind === k} class={d.kind === k ? "active" : ""} onClick={() => switchKind(k)}>
            {KIND_LABEL[k]}
          </button>
        ))}
        <span class="muted hint">{editing ? "Editing" : "New"} · Enter saves · Esc closes</span>
      </div>

      <div class="fields">
        <DateField label="Date" error={err.date} value={d.date} min={yearStart(setup)} max={`${setup.year}-12-31`}
          onChange={(date) => set("date", date)} />
        <Field label="Item" error={err.item} class="w-item">
          <input ref={itemRef} type="text" value={d.item} placeholder="What was it?"
            onInput={(e) => set("item", e.currentTarget.value)} />
        </Field>
        <Field label="Amount" error={err.amount} class="w-amount">
          <input type="text" inputMode="decimal" value={d.amount} placeholder="0.00" class="num"
            onInput={(e) => set("amount", e.currentTarget.value)}
            // The live draft, not the field: a save clears the draft and moves focus here before the
            // field re-renders, and tidying the old text would bring the last amount back.
            onBlur={() => { const a = draft.value.amount, t = tidyAmount(a); if (t !== a) set("amount", t); }} />
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
            <AccountSelect accounts={accounts.filter((a) => a.type !== "loan")} value={d.account} onChange={(v) => set("account", v)} />
          </Field>
        )}

        <Field label="Category" error={err.cat} class="w-cat">
          <SearchSelect value={d.cat} choices={setup.categories[d.kind].map((c) => ({ value: c.id, label: c.name }))}
            onChange={(v) => { catPicked.value = true; set("cat", v); }} />
        </Field>

        {members.length > 1 && (
          <Field label="Person" error={err.member} class="w-account">
            {/* The first person is the default and is stored as "". */}
            <select value={d.member || members[0]!.id}
              onChange={(e) => set("member", e.currentTarget.value === members[0]!.id ? "" : e.currentTarget.value)}>
              {members.map((m) => <option value={m.id}>{m.name}</option>)}
            </select>
          </Field>
        )}
      </div>

      {d.kind === "expense" && (
        <div class="fields">
          <Field label="Tags" error={err.tags} class="w-tags" group>
            <TagPicker setup={setup} value={d.tags} onChange={(tags) => set("tags", tags)} />
          </Field>
        </div>
      )}

      {role === "offset" && (
        <div class="fields">
          <Field label="Reduces spending on" error={err.offsets} class="w-cat">
            <SearchSelect value={d.offsets} onChange={(v) => set("offsets", v)}
              choices={[{ value: "", label: "All spending" }, ...setup.categories.expense.map((c) => ({ value: c.id, label: c.name }))]} />
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
      {failed.value && <p class="form-error" role="alert">{failed.value}</p>}
    </form>
  );
}

/**
 * A labelled field, normally wrapped in a <label>. It's a <div> instead for controls with buttons
 * inside (`group`): clicking a label clicks its first button, which for tags removed the first chip.
 */
function Field(props: { label: string; error?: string; class?: string; group?: boolean; children: JSX.Element | JSX.Element[] }) {
  const Tag = props.group ? "div" : "label";
  return (
    <Tag class={`field ${props.class ?? ""} ${props.error ? "has-error" : ""}`} role={props.group ? "group" : undefined}
      aria-label={props.group ? props.label : undefined}>
      <span class="field-label">{props.label}</span>
      {props.children}
      {props.error && <span class="field-error">{props.error}</span>}
    </Tag>
  );
}

const TYPE_LABEL: Record<Account["type"], string> = {
  checking: "Bank", savings: "Savings", cash: "Cash", credit: "Credit cards", investment: "Investments", loan: "Loans", asset: "Assets",
};

function AccountSelect(props: { accounts: Account[]; value: string; onChange: (id: string) => void }) {
  const groups = (Object.keys(TYPE_LABEL) as Account["type"][])
    .map((type) => [type, props.accounts.filter((a) => a.type === type)] as const)
    .filter(([, list]) => list.length);
  return (
    <SearchSelect value={props.value} onChange={props.onChange}
      choices={groups.flatMap(([type, list]) => list.map((a) => ({ value: a.id, label: a.name, group: TYPE_LABEL[type] })))} />
  );
}

/**
 * Chosen tags as chips, plus a box to add more. Type a name and press Enter or comma:
 * an existing tag is added, a new name creates the tag. While typing, matching tags are
 * listed below: arrows pick one, Enter or a click adds it. Backspace in the empty box
 * removes the last chip.
 */
function TagPicker(props: { setup: YearSetup; value: string[]; onChange: (ids: string[]) => void }) {
  const text = useSignal("");
  const open = useSignal(false);
  /** The highlighted suggestion, or -1 for none: then Enter adds what was typed. */
  const active = useSignal(-1);
  const names = new Map(props.setup.tags.map((t) => [t.id, t.name]));
  const shown = matching(props.setup.tags.filter((t) => !props.value.includes(t.id)).map((t) => ({ value: t.id, label: t.name })), text.value);
  const listing = open.value && shown.length > 0;

  function addId(id: string) {
    if (!props.value.includes(id)) props.onChange([...props.value, id]);
    text.value = "";
    active.value = -1;
  }

  async function add() {
    const name = text.value.trim();
    if (!name) return;
    addId(await ensureTag(name));
  }

  function onKeyDown(e: KeyboardEvent) {
    if ((e.key === "ArrowDown" || e.key === "ArrowUp") && listing) {
      e.preventDefault();
      active.value = Math.min(Math.max(active.value + (e.key === "ArrowDown" ? 1 : -1), -1), shown.length - 1);
    } else if (e.key === "Enter" && listing && active.value >= 0) {
      e.preventDefault();
      e.stopPropagation();
      addId(shown[active.value]!.value);
    } else if ((e.key === "Enter" || e.key === ",") && text.value.trim()) {
      e.preventDefault();
      e.stopPropagation();
      add();
    } else if (e.key === "Escape" && listing) {
      // Closes the suggestions first; a second Esc closes the form.
      e.preventDefault();
      e.stopPropagation();
      open.value = false;
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
      <input type="text" value={text.value} placeholder={props.value.length ? "" : "Add tags…"} role="combobox"
        aria-expanded={listing} aria-autocomplete="list"
        onInput={(e) => { text.value = e.currentTarget.value; active.value = -1; open.value = true; }}
        onFocus={() => (open.value = true)} onBlur={() => (open.value = false)} onKeyDown={onKeyDown} />
      {listing && (
        // Mousedown is held back so the box keeps focus; click is held back from the <label> around it.
        <div class="search-select-pop tag-suggest" onMouseDown={(e) => e.preventDefault()} onClick={(e) => e.preventDefault()}>
          <ul role="listbox">
            {shown.map((c, i) => (
              <li role="option" aria-selected={i === active.value} class={i === active.value ? "active" : ""}
                onMouseMove={() => (active.value = i)} onClick={() => addId(c.value)}>
                {c.label}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
