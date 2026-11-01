// Small outline icons for row actions, drawn here so they look the same on every device
// (emoji and symbol characters don't). They take the text colour; the button names the action.

import type { JSX } from "preact";

const PATHS = {
  /** Update balance / value: a line going up. */
  update: <><polyline points="22 7 13.5 15.5 8.5 10.5 2 17" /><polyline points="16 7 22 7 22 13" /></>,
  /** Export JSON: a download. */
  export: <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><path d="M12 15V3" /></>,
  edit: <><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" /></>,
  duplicate: <><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></>,
  /** Close: shut for good. */
  close: <><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></>,
  reopen: <><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 9.9-1" /></>,
  hide: <><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c6.5 0 10 8 10 8a13.16 13.16 0 0 1-1.67 2.68" /><path d="M6.61 6.61A13.53 13.53 0 0 0 2 12s3.5 8 10 8a9.74 9.74 0 0 0 5.39-1.61" /><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" /><path d="M2 2l20 20" /></>,
  unhide: <><path d="M2 12s3.5-8 10-8 10 8 10 8-3.5 8-10 8S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></>,
  delete: <><path d="M3 6h18" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></>,
} satisfies Record<string, JSX.Element>;

export type IconName = keyof typeof PATHS;

export function Icon({ name }: { name: IconName }) {
  return (
    <svg class="icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"
      stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      {PATHS[name]}
    </svg>
  );
}

/**
 * A square button showing only an icon. The label is what screen readers say; the tooltip
 * (`title`, or the label) is what a pointer shows, since the icon alone doesn't name the action.
 */
export function IconButton(props: {
  icon: IconName; label: string; title?: string; danger?: boolean; onClick: () => void;
}) {
  return (
    <button type="button" class={`icon-action icon-${props.icon} ${props.danger ? "danger" : ""}`} aria-label={props.label}
      title={props.title ?? props.label} onClick={props.onClick}>
      <Icon name={props.icon} />
    </button>
  );
}
