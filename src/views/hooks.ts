// Small hooks the views share.

import { signal, type Signal } from "@preact/signals";
import { useEffect } from "preact/hooks";

/** Closes an open menu on Esc, or on a tap outside what `inside` selects. */
export function useDismiss(open: Signal<boolean>, inside: string) {
  useEffect(() => {
    if (!open.value) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !(e.target as Element).closest(inside)) open.value = false;
    };
    document.addEventListener("keydown", close);
    document.addEventListener("pointerdown", close);
    return () => {
      document.removeEventListener("keydown", close);
      document.removeEventListener("pointerdown", close);
    };
  }, [open.value]);
}

/** Something another page asks a page to do once it's open, like the Add button opening a form. */
export function pageRequest(hash: string) {
  const asked = signal(false);
  return {
    ask() {
      asked.value = true;
      location.hash = hash;
    },
    /** In the page: runs `run` for a request, whether it came before the page opened or while it's open. */
    useAsked(run: () => void) {
      useEffect(() => {
        if (!asked.value) return;
        asked.value = false;
        run();
      }, [asked.value]);
    },
  };
}
