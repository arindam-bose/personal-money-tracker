// A round ? that shows a description on hover or focus: in a card's top right corner (CardTitle),
// or at the top right of a page (PageHelp).

import type { ComponentChildren } from "preact";
import { useId, useRef } from "preact/hooks";

// A tap outside an open tip closes it. Most browsers move focus off the ? by themselves then, but
// iOS Safari doesn't blur a button when the tap lands on something it can't focus (text, a card),
// so the tip would stay over the page.
if (typeof document !== "undefined") {
  document.addEventListener("pointerdown", (e) => {
    const open = document.activeElement;
    if (open instanceof HTMLElement && open.classList.contains("help-btn") && !open.parentElement?.contains(e.target as Node)) open.blur();
  });
}

/**
 * The ? and its tip. The tip is drawn by CSS on hover and on focus, so a keyboard (Tab), a click
 * or a tap shows it too; Esc, a second tap on the ?, or a tap elsewhere hides it again. Screen
 * readers hear it as the button's description.
 */
function Help(props: { label: string; children: ComponentChildren }) {
  const id = useId();
  /** Whether the tip was already open as this click began: then the click closes it. */
  const wasOpen = useRef(false);
  return (
    <span class="help">
      <button type="button" class="help-btn" aria-label={props.label} aria-describedby={id}
        // Safari doesn't focus a button it clicks or taps, and the tip shows on focus: focus it here.
        // Asked before the press moves focus, so a second tap on an open tip closes it.
        onPointerDown={(e) => (wasOpen.current = document.activeElement === e.currentTarget)}
        onClick={(e) => {
          if (wasOpen.current) e.currentTarget.blur();
          else e.currentTarget.focus();
          wasOpen.current = false;
        }}
        onKeyDown={(e) => e.key === "Escape" && e.currentTarget.blur()}>?</button>
      <span class="help-tip" role="tooltip" id={id}>{props.children}</span>
    </span>
  );
}

/** A card's title, with the ? in the card's top right corner. */
export function CardTitle(props: { title: ComponentChildren; children: ComponentChildren }) {
  return (
    <div class="card-title">
      <h3>{props.title}</h3>
      <span class="card-help"><Help label="About this card">{props.children}</Help></span>
    </div>
  );
}

/** A ? at the top right of a page, for what the whole page shows. */
export function PageHelp(props: { children: ComponentChildren }) {
  return <div class="page-help"><Help label="About this page">{props.children}</Help></div>;
}
