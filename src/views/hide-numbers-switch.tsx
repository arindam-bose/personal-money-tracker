// The Hide numbers switch, for the Dashboard and the close-year balances in Settings.

import { HIDDEN_AMOUNT, numbersHidden, setNumbersHidden } from "../hide-numbers";

/**
 * Hide numbers: a switch, on while the amounts show as dots. At the right of the Dashboard's period and
 * person pickers, and over the balances when closing a year while they're hidden. The choice is kept on
 * this device and covers every page, not just the one it's on (src/hide-numbers.ts).
 */
export function HideNumbers() {
  const on = numbersHidden.value;
  return (
    <button type="button" role="switch" aria-checked={on} class="toggle hide-numbers"
      title={`Show amounts as ${HIDDEN_AMOUNT} on every page, for when someone can see the screen. Kept on this device only.`}
      onClick={() => setNumbersHidden(!on)}>
      <span class="toggle-track" aria-hidden="true"><span class="toggle-knob" /></span>
      Hide numbers
    </button>
  );
}
