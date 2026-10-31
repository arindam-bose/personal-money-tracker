// A small "Saved" by whatever was just saved, fading out after a moment. Changes on the
// Accounts page save as they're made, with no Save button, so this says they went through.

import { useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";

const SHOWN_MS = 2000;

/** Which thing (a row's id, or a name like "start") was saved last, until its "Saved" fades. */
export function useSaved() {
  // A count as well as the key, so saving the same row twice starts the fade over.
  const last = useSignal<{ key: string; n: number } | null>(null);
  const timer = useRef<number>();
  useEffect(() => () => clearTimeout(timer.current), []);

  function flash(key: string) {
    last.value = { key, n: (last.value?.n ?? 0) + 1 };
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => (last.value = null), SHOWN_MS);
  }

  /** The "Saved" mark for `key`, if it was the last thing saved; nothing otherwise. */
  function mark(key: string) {
    const l = last.value;
    return l?.key === key ? <span key={l.n} class="saved-mark" role="status">Saved</span> : null;
  }

  return { flash, mark };
}

/** The id of the item named `name` in `list`, as saving tidies names (trimmed, any case). */
export function idByName(list: { id: string; name: string }[], name: string): string | undefined {
  const wanted = name.trim().toLowerCase();
  return list.find((x) => x.name.toLowerCase() === wanted)?.id;
}
