// A dropdown with a search box: looks like a <select>, but opens a list you can type into.
// Used where lists get long (accounts, categories, tags). Keyboard: Down, Space or typing
// opens it; arrows move; Enter picks; Esc or Tab closes. Enter on the closed button saves the
// form it's in, as on a plain dropdown; outside a form it opens the list.

import { useSignal } from "@preact/signals";
import { Fragment } from "preact";
import { useEffect, useId, useRef } from "preact/hooks";

export interface Choice {
  value: string;
  label: string;
  /** A heading the choice sits under, like an <optgroup>. Searching matches it too. */
  group?: string;
}

/** The choices whose name or group holds the search text, ignoring case. */
export function matching(choices: Choice[], query: string): Choice[] {
  const q = query.trim().toLowerCase();
  return q ? choices.filter((c) => c.label.toLowerCase().includes(q) || c.group?.toLowerCase().includes(q)) : choices;
}

export function SearchSelect(props: {
  value: string;
  choices: Choice[];
  onChange: (value: string) => void;
  /** Shown when the value matches no choice, e.g. "Choose a tag…". */
  placeholder?: string;
  "aria-label"?: string;
  title?: string;
}) {
  const open = useSignal(false);
  const query = useSignal("");
  const active = useSignal(0);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const id = useId();

  const shown = matching(props.choices, query.value);
  const current = props.choices.find((c) => c.value === props.value);

  function show(seed = "") {
    query.value = seed;
    // Start on the current choice, so arrows move from where you are.
    const at = seed ? 0 : props.choices.findIndex((c) => c.value === props.value);
    active.value = Math.max(0, at);
    open.value = true;
  }

  function close(refocus: boolean) {
    open.value = false;
    if (refocus) button.current?.focus();
  }

  function pick(c: Choice | undefined) {
    if (!c) return;
    close(true);
    if (c.value !== props.value) props.onChange(c.value);
  }

  // A click anywhere else closes it. Clicks on a <label> around it are left to the button, which
  // the label clicks: closing here too would have the button open it straight back up. Focus
  // moves to the search box by hand: browsers ignore autofocus on elements added after load.
  useEffect(() => {
    if (!open.value) return;
    search.current?.focus();
    const zone = root.current?.closest("label") ?? root.current;
    const outside = (e: MouseEvent) => !zone?.contains(e.target as Node) && close(false);
    document.addEventListener("mousedown", outside);
    return () => document.removeEventListener("mousedown", outside);
  }, [open.value]);

  // Keep the highlighted choice in view while arrowing through a long list.
  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-i="${active.value}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active.value, open.value]);

  function onButtonKey(e: KeyboardEvent) {
    const form = button.current?.closest("form");
    if (e.key === "Enter" && form) {
      // Saves, instead of the button's own Enter, which would open the list.
      e.preventDefault();
      form.requestSubmit();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === " ") {
      e.preventDefault();
      show();
    } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      // Typing on the closed dropdown starts the search with that letter, and the letter
      // goes no further: on the ledger, E, I and T would otherwise add an entry.
      e.preventDefault();
      e.stopPropagation();
      show(e.key);
    }
  }

  function onSearchKey(e: KeyboardEvent) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : -1;
      active.value = Math.min(Math.max(active.value + step, 0), shown.length - 1);
    } else if (e.key === "Enter") {
      // Picks; never reaches the form, so it doesn't save as well.
      e.preventDefault();
      e.stopPropagation();
      pick(shown[active.value]);
    } else if (e.key === "Escape") {
      // Closes the list only, not the entry form around it.
      e.preventDefault();
      e.stopPropagation();
      close(true);
    } else if (e.key === "Tab") {
      close(false);
    }
  }

  let lastGroup: string | undefined;
  return (
    <div class="search-select" ref={root}>
      <button type="button" ref={button} class="search-select-button" aria-haspopup="listbox" aria-expanded={open.value}
        aria-label={props["aria-label"]} title={props.title ?? current?.label}
        onClick={() => (open.value ? close(true) : show())} onKeyDown={onButtonKey}>
        <span class={current ? "" : "muted"}>{current?.label ?? props.placeholder ?? "Choose…"}</span>
      </button>
      {open.value && (
        // Clicks in here mustn't reach a <label> around the dropdown: it would click the button again.
        <div class="search-select-pop" onClick={(e) => e.preventDefault()}>
          <input ref={search} type="search" placeholder="Search…" value={query.value} aria-label="Search the list"
            role="combobox" aria-expanded="true" aria-controls={`${id}-list`}
            aria-activedescendant={shown.length ? `${id}-${active.value}` : undefined}
            onInput={(e) => { query.value = e.currentTarget.value; active.value = 0; }} onKeyDown={onSearchKey} />
          <ul role="listbox" id={`${id}-list`} ref={list}>
            {shown.map((c, i) => {
              const heading = c.group !== lastGroup && c.group ? <li class="search-select-group" role="presentation">{c.group}</li> : null;
              lastGroup = c.group;
              return (
                <Fragment key={c.value}>
                  {heading}
                  <li id={`${id}-${i}`} data-i={i} role="option" aria-selected={c.value === props.value}
                    class={`${i === active.value ? "active" : ""} ${c.value === props.value ? "chosen" : ""}`}
                    onMouseMove={() => (active.value = i)} onClick={() => pick(c)}>
                    {c.label}
                  </li>
                </Fragment>
              );
            })}
            {shown.length === 0 && <li class="search-select-none muted">No matches</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
