// A card's title, with a round ? in the card's top right corner. Hovering or focusing the ? shows what the card is about.

import type { ComponentChildren } from "preact";
import { useId } from "preact/hooks";

/**
 * The tip is drawn by CSS on hover and on focus, so a keyboard (Tab) or a tap shows it too;
 * Esc hides it again. Screen readers hear it as the button's description.
 */
export function CardTitle(props: { title: ComponentChildren; children: ComponentChildren }) {
  const id = useId();
  return (
    <div class="card-title">
      <h3>{props.title}</h3>
      <span class="card-help">
        <button type="button" class="help-btn" aria-label="About this card" aria-describedby={id}
          onKeyDown={(e) => e.key === "Escape" && e.currentTarget.blur()}>?</button>
        <span class="help-tip" role="tooltip" id={id}>{props.children}</span>
      </span>
    </div>
  );
}
