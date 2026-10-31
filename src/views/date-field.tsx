// A date field with a Today link by its label, and T in the field, to set today's date.

import { useId } from "preact/hooks";
import { localToday } from "../derive";

/**
 * The browser's own date picker can't take a Today button, so it sits on the label; T does the same.
 * Today is only offered when it's between `min` and `max`. The wrapper is a <div>, not a <label>:
 * the button would take the label, so the label names the input by id.
 */
export function DateField(props: {
  label: string; value: string; min: string; max: string; onChange: (date: string) => void;
  error?: string; class?: string;
}) {
  const today = localToday();
  const id = useId();
  const canToday = today >= props.min && today <= props.max;

  return (
    <div class={`field w-date ${props.class ?? ""} ${props.error ? "has-error" : ""}`}>
      <span class="field-head">
        <label class="field-label" for={id}>{props.label}</label>
        {canToday && props.value !== today && (
          <button type="button" class="link field-action" onClick={() => props.onChange(today)} title="Set the date to today (T)">Today</button>
        )}
      </span>
      <input id={id} type="date" value={props.value} min={props.min} max={props.max}
        onInput={(e) => props.onChange(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (canToday && e.key.toLowerCase() === "t" && !e.ctrlKey && !e.metaKey && !e.altKey) {
            e.preventDefault();
            props.onChange(today);
          }
        }} />
      {props.error && <span class="field-error">{props.error}</span>}
    </div>
  );
}
