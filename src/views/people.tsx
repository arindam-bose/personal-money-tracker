// The household picker shared by the Dashboard and Reports: "All people", or one person.
// With a single person (the usual case) it doesn't show, and everything is everyone's.

import { forMember, type Ledger } from "../derive";
import { membersOf } from "../setup";
import { current, ledger, memberView, setMemberView } from "../state";
import type { Member } from "../types";

/** The person being viewed, or null for everyone (also when they don't exist in the open year). */
export function viewedMember(): Member | null {
  const setup = current.value?.setup;
  if (!setup) return null;
  const members = membersOf(setup);
  return members.length > 1 ? members.find((m) => m.id === memberView.value) ?? null : null;
}

/** The open year's ledger for the person being viewed; everyone's when nobody is picked. */
export function viewedLedger(): Ledger | null {
  const l = ledger.value;
  const setup = current.value?.setup;
  const m = viewedMember();
  return l && setup && m ? forMember(l, m.id, membersOf(setup)[0]!.id) : l;
}

/** "All people · Person A · Person B". Hidden while there's only one person. */
export function MemberPicker() {
  const setup = current.value?.setup;
  if (!setup) return null;
  const members = membersOf(setup);
  if (members.length < 2) return null;
  return (
    <select aria-label="Person" value={viewedMember()?.id ?? ""} onChange={(e) => setMemberView(e.currentTarget.value)}>
      <option value="">All people</option>
      {members.map((m) => <option value={m.id}>{m.name}</option>)}
    </select>
  );
}
