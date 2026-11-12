// A modal dialog in the app's own style: a title, then whatever the caller puts below it.
// Esc closes it (the browser's own), and so does a click on the backdrop.

import type { ComponentChildren, RefObject } from "preact";
import { useId, useRef } from "preact/hooks";

/**
 * Open it with `dialogRef.current.showModal()`. `onClose` runs however it closes. Focus starts on
 * the title, so a long dialog opens at its top, not scrolled to its buttons.
 */
export function Modal(props: {
  dialogRef: RefObject<HTMLDialogElement>; title: ComponentChildren; class?: string; onClose?: () => void;
  children: ComponentChildren;
}) {
  const id = useId();
  // A backdrop click lands on the dialog itself. So does a drag that starts inside (selecting
  // text) and ends on the backdrop, so the press must have started on the backdrop too.
  const pressedBackdrop = useRef(false);
  return (
    <dialog ref={props.dialogRef} class={`guide ${props.class ?? ""}`} aria-labelledby={id} onClose={props.onClose}
      onMouseDown={(e) => (pressedBackdrop.current = e.target === e.currentTarget)}
      onClick={(e) => pressedBackdrop.current && e.target === e.currentTarget && e.currentTarget.close()}>
      <div class="guide-body">
        <h2 id={id} tabIndex={-1} autofocus>{props.title}</h2>
        {props.children}
      </div>
    </dialog>
  );
}
