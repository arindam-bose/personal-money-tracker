// "Pin a total": the card that pins a spending category's or a tag's total, on the Dashboard
// (as a tile) and on Over the years (as a chart). What's pinned is kept in `pins` (state.ts).

import { pins, savePins } from "../state";
import type { PinSetting } from "../types";
import { SearchSelect } from "./search-select";

/** Choices of one kind: not pinned yet, and one per name (the first given), however many ids it had. */
function choicesOf(names: Map<string, string>, pinned: string[], kind: "cat" | "tag", group: string) {
  const seen = new Set(pinned.map((id) => names.get(id)?.toLowerCase()));
  const choices = [];
  for (const [id, name] of names) {
    if (seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    choices.push({ value: `${kind}:${id}`, label: name, group });
  }
  return choices;
}

/**
 * The picker, under "Spending categories" and "Tags". `categories` and `tags` map ids to names;
 * `keys` says which pin lists it adds to. Gone once everything is pinned.
 */
export function PinTotal(props: {
  categories: Map<string, string>; tags: Map<string, string>;
  keys: { cat: PinSetting; tag: PinSetting }; class?: string; label: string;
}) {
  const { keys } = props;
  const choices = [
    ...choicesOf(props.categories, pins[keys.cat].value, "cat", "Spending categories"),
    ...choicesOf(props.tags, pins[keys.tag].value, "tag", "Tags"),
  ];
  if (!choices.length) return null;
  return (
    <label class={`card pin-tile ${props.class ?? ""}`}>
      <span class="tile-label">Pin a total</span>
      <SearchSelect value="" placeholder="Category or tag…" aria-label={props.label} choices={choices}
        onChange={(v) => {
          const key = keys[v.slice(0, 3) as "cat" | "tag"];
          savePins(key, [...pins[key].value, v.slice(4)]);
        }} />
    </label>
  );
}
