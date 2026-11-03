// The floating Add button on small screens: it opens into Add Transaction and Add Account, whatever
// page you're on. What it offers comes from addChoices (setup.ts). style.css shows it only where
// the page links fold into a menu, and hides it while a form is open or the keyboard is up.

import { useSignal } from "@preact/signals";
import { addChoices } from "../setup";
import { current } from "../state";
import { askToAddAccount } from "./accounts";
import { useDismiss } from "./hooks";
import { askToAddEntry } from "./ledger";

const CHOICES = {
  transaction: { label: "Add Transaction", run: askToAddEntry },
  account: { label: "Add Account", run: askToAddAccount },
};

export function AddMenu() {
  const open = useSignal(false);

  useDismiss(open, ".add-menu");

  const choices = addChoices(current.value?.setup);
  if (!choices.length) return null;
  return (
    <div class={`add-menu ${open.value ? "open" : ""}`}>
      {open.value && (
        <div class="add-menu-choices" id="add-choices">
          {choices.map((c) => (
            <button type="button" onClick={() => { open.value = false; CHOICES[c].run(); }}>{CHOICES[c].label}</button>
          ))}
        </div>
      )}
      <button type="button" class="add-menu-btn primary" aria-label="Add" aria-haspopup="true" aria-expanded={open.value}
        aria-controls={open.value ? "add-choices" : undefined} onClick={() => (open.value = !open.value)}>
        <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
          <path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" />
        </svg>
      </button>
    </div>
  );
}
