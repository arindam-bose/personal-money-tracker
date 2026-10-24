// The household basics, kept apart so the entry checks (entries.ts) can use them
// without importing setup.ts, which imports entries.ts.

import type { Member, YearSetup } from "./types";

/** Everyone starts as this one member. */
export const DEFAULT_MEMBER: Member = { id: "m_person-a", name: "Person A" };

/** The household, never empty. The first member is the default: entries without `member` are theirs. */
export function membersOf(setup: Pick<YearSetup, "members">): Member[] {
  return setup.members?.length ? setup.members : [DEFAULT_MEMBER];
}
