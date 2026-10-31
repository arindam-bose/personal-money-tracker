// A round ? that shows a description on hover or focus: in a card's top right corner (CardTitle),
// or at the top right of a page (PageHelp).

import type { ComponentChildren } from "preact";
import { useId } from "preact/hooks";

/**
 * The ? and its tip. The tip is drawn by CSS on hover and on focus, so a keyboard (Tab) or a
 * tap shows it too; Esc hides it again. Screen readers hear it as the button's description.
 */
function Help(props: { label: string; children: ComponentChildren }) {
  const id = useId();
  return (
    <span class="help">
      <button type="button" class="help-btn" aria-label={props.label} aria-describedby={id}
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
