// Date boxes with a Today link, and T in the box, to set today's date.

import type { JSX } from "preact";
import { useId } from "preact/hooks";
import { localToday } from "../derive";

/** Today, when a date box limited to `min`..`max` (either end open) may take it; otherwise null. */
function todayWithin(min?: string, max?: string): string | null {
  const today = localToday();
  return (!min || today >= min) && (!max || today <= max) ? today : null;
}

/** T in a date box sets today, as the Today link does. */
function todayKey(today: string | null, onChange: (date: string) => void) {
  return (e: JSX.TargetedKeyboardEvent<HTMLInputElement>) => {
    if (today && e.key.toLowerCase() === "t" && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      onChange(today);
    }
  };
}

/**
 * The Today link. It stays in place while the date is today, greyed out, so it's always there to
 * find (hiding it then made the boxes that start on today look as if they had none).
 */
function TodayLink(props: { today: string; value: string; onChange: (date: string) => void }) {
  const isToday = props.value === props.today;
  return (
    <button type="button" class="link field-action" disabled={isToday}
      title={isToday ? "The date is already today" : "Set the date to today (T)"} onClick={() => props.onChange(props.today)}>
      Today
    </button>
  );
}

/**
 * A labelled date field. The browser's own date picker can't take a Today button, so it sits on
 * the label. Today is only offered when it's between `min` and `max`. The wrapper is a <div>, not
 * a <label>: the button would take the label, so the label names the input by id.
 */
export function DateField(props: {
  label: string; value: string; min?: string; max?: string; onChange: (date: string) => void;
  error?: string; class?: string;
}) {
  const today = todayWithin(props.min, props.max);
  const id = useId();

  return (
    <div class={`field w-date ${props.class ?? ""} ${props.error ? "has-error" : ""}`}>
      <span class="field-head">
        <label class="field-label" for={id}>{props.label}</label>
        {today && <TodayLink today={today} value={props.value} onChange={props.onChange} />}
      </span>
      <input id={id} type="date" value={props.value} min={props.min} max={props.max}
        onInput={(e) => props.onChange(e.currentTarget.value)} onKeyDown={todayKey(today, props.onChange)} />
      {props.error && <span class="field-error">{props.error}</span>}
    </div>
  );
}

/**
 * A date box in a line of text or a row of filters, with the Today link after it. `todayLink:
 * false` leaves the link out (T still works), where a second link beside a first would crowd.
 */
export function DateInput(props: {
  value: string; min?: string; max?: string; onChange: (date: string) => void;
  "aria-label"?: string; title?: string; disabled?: boolean; onFocus?: () => void; todayLink?: boolean;
}) {
  const today = props.disabled ? null : todayWithin(props.min, props.max);
  return (
    <span class="date-input">
      <input type="date" value={props.value} min={props.min} max={props.max} aria-label={props["aria-label"]} title={props.title}
        disabled={props.disabled} onFocus={props.onFocus}
        onInput={(e) => props.onChange(e.currentTarget.value)} onKeyDown={todayKey(today, props.onChange)} />
      {today && props.todayLink !== false && <TodayLink today={today} value={props.value} onChange={props.onChange} />}
    </span>
  );
}
