// Importing a backup from anywhere: the top bar's Import, Settings' Import JSON, or a file dropped
// on any page. They all go through importFile (importing.ts) and share one "Replace?" dialog, a
// drop overlay and a notice saying what was imported. ImportLayer is mounted once, in app.tsx.
// The same as the Habit Tracker's, one file at a time.

import { signal } from "@preact/signals";
import type { ComponentChildren } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { dateTime, lastUpdatedAt } from "../derive";
import { importFile } from "../importing";
import type { YearSummary } from "../state";
import { backupText } from "../storage";
import type { YearFile } from "../types";
import { Icon } from "./icons";
import { Modal } from "./modal";

/** "1 entry", "1,276 entries". */
const entryCount = (n: number) => `${n.toLocaleString()} ${n === 1 ? "entry" : "entries"}`;

/** A long list of problems is cut here: the first ones say what's wrong. */
const MAX_ERRORS = 50;

let asked = 0;

/** An import waiting on "Replace?": the file, as read and checked, the year it would replace, and the answer to give. */
interface PendingReplace {
  /** Counts the questions, so each one gets a dialog of its own. */
  id: number;
  fileName: string;
  file: YearFile;
  stored: YearSummary;
  answer: (replace: boolean) => void;
}

/**
 * The question before an import replaces a stored year: what is here now and what the file holds,
 * side by side, with the rows that differ highlighted. Esc, Cancel or a click on the backdrop keeps
 * the stored year.
 */
function ReplaceDialog(props: { pending: PendingReplace }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  const { fileName, file, stored, answer } = props.pending;
  const at = new Date(file.exportedAt);
  const exported = Number.isNaN(at.getTime())
    ? "No export date"
    : `Exported ${at.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}`;
  // The latest change of either kind, entries or setup, as the strip under the top bar shows it.
  // A file without one was saved before files carried it, so anything changed here is newer.
  const here = lastUpdatedAt(stored.setup);
  const there = lastUpdatedAt(file);
  // To the second, as the table shows them: a warning under a row that reads the same would confuse.
  const newerHere = here !== undefined && (there === undefined || toSecond(here) > toSecond(there));
  const counts = { expenses: file.expenses.length, earnings: file.earnings.length, transfers: file.transfers.length };
  const total = (c: typeof counts) => c.expenses + c.earnings + c.transfers;
  const rows: { label: string; now: string; inFile: string; compare: boolean }[] = [
    { label: "Expenses", now: stored.expenses.toLocaleString(), inFile: counts.expenses.toLocaleString(), compare: true },
    { label: "Earnings", now: stored.earnings.toLocaleString(), inFile: counts.earnings.toLocaleString(), compare: true },
    { label: "Transfers", now: stored.transfers.toLocaleString(), inFile: counts.transfers.toLocaleString(), compare: true },
    { label: "Total entries", now: total(stored).toLocaleString(), inFile: total(counts).toLocaleString(), compare: true },
    { label: "Last updated", now: updatedText(here), inFile: updatedText(there), compare: true },
    // A backup and an export are different events, so this row is context, never a difference.
    { label: "Backup", now: backupText(stored.setup.lastBackupAt), inFile: exported, compare: false },
  ];
  // Answered once, however the dialog closes: Replace answers yes, and the close that follows is ignored.
  const answered = useRef(false);
  const reply = (replace: boolean) => {
    if (answered.current) return;
    answered.current = true;
    answer(replace);
  };
  // Should the dialog ever be removed without a close event, that counts as Cancel, or the
  // import waiting on the answer would never go on.
  useEffect(() => () => reply(false), []);
  return (
    <Modal dialogRef={dialog} title={`Replace your ${file.year} data?`} onClose={() => reply(false)}>
      <p>"{fileName}" holds {file.year} too. Importing it replaces everything the tracker has for {file.year}.</p>
      <table class="compare">
        <thead>
          <tr>
            <th></th>
            <th>In the tracker</th>
            <th>In the file</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label} class={r.compare && r.now !== r.inFile ? "differs" : undefined}>
              <th scope="row">{r.label}</th>
              <td>{r.now}</td>
              <td>{r.inFile}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {newerHere && <p class="warn">The tracker has newer changes than this file: replacing it loses them.</p>}
      <p class="muted">This can't be undone.</p>
      <div class="form-actions">
        <button type="button" onClick={() => dialog.current?.close()}>Cancel</button>
        <button type="button" class="danger-solid" onClick={() => reply(true)}>Replace {file.year}</button>
      </div>
    </Modal>
  );
}

const toSecond = (iso: string) => Math.floor(Date.parse(iso) / 1000);

/** With seconds: two backups taken minutes apart must still read differently. */
function updatedText(iso: string | undefined): string {
  return iso ? dateTime(iso, true) : "Unknown";
}

/** An import asking whether to replace a stored year. */
const replacing = signal<PendingReplace | null>(null);
/** What the last import did, for the notice; null once closed. */
const report = signal<{ id: number; done?: string; heading?: string; errors: string[]; note?: string } | null>(null);
/** A file is being dragged over the page. */
const dragging = signal(false);
/** An import is under way: another is ignored rather than asking two things at once. */
let busy = false;

/** Ask in the dialog; resolves with the answer once it closes. */
function askReplace(fileName: string, stored: YearSummary, file: YearFile): Promise<boolean> {
  return new Promise((resolve) => {
    replacing.value = { id: ++asked, fileName, stored, file, answer: (yes) => { replacing.value = null; resolve(yes); } };
  });
}

/**
 * Import a picked or dropped file, then say what happened. One at a time: of several dropped, the
 * first is imported and the notice says the rest weren't. Ignored while another import is asking.
 */
export async function startImport(files: File[]): Promise<void> {
  const file = files[0];
  if (!file || busy) return;
  busy = true;
  report.value = null;
  const note = files.length > 1 ? `One file at a time: the other ${files.length - 1 === 1 ? "file wasn't" : `${files.length - 1} files weren't`} imported.` : undefined;
  try {
    const out = await importFile(file, askReplace);
    const id = ++asked;
    if (out.kind === "imported") report.value = { id, done: `Imported ${out.year} (${entryCount(out.entries)}) from "${out.fileName}".`, errors: [], note };
    else if (out.kind === "failed") {
      const extra = out.errors.length > MAX_ERRORS ? [`…and ${out.errors.length - MAX_ERRORS} more.`] : [];
      report.value = { id, heading: `"${out.fileName}" was not imported:`, errors: [...out.errors.slice(0, MAX_ERRORS), ...extra], note };
    } else if (note) report.value = { id, errors: [], note };
  } catch (err) {
    report.value = { id: ++asked, errors: [err instanceof Error ? err.message : String(err)] };
  } finally {
    busy = false;
  }
}

/**
 * A button that opens the file picker for a backup. The input sits inside the label, out of
 * sight but not hidden, so the keyboard reaches it and the label's focus ring shows.
 */
export function ImportButton(props: { class?: string; title?: string; children: ComponentChildren }) {
  return (
    <label class={`button file-button ${props.class ?? ""}`} title={props.title}>
      {props.children}
      <input type="file" accept=".json,application/json" class="sr-only" onChange={(e) => {
        const input = e.currentTarget;
        const files = [...(input.files ?? [])];
        input.value = ""; // so picking the same file again still fires a change
        void startImport(files);
      }} />
    </label>
  );
}

const hasFiles = (e: DragEvent) => e.dataTransfer?.types.includes("Files") ?? false;

/** The dialog, the drop overlay and the notice, for every page. Listens for a file dropped anywhere. */
export function ImportLayer() {
  useEffect(() => {
    // Entering a child fires dragenter before the parent's dragleave: count, so the overlay doesn't flicker.
    let depth = 0;
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth++;
      dragging.value = true;
    };
    const over = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      // Without this the browser would open the file in place of the tracker.
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = busy ? "none" : "copy";
    };
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (!depth) dragging.value = false;
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      dragging.value = false;
      void startImport([...(e.dataTransfer?.files ?? [])]);
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragover", over);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
    };
  }, []);

  // A notice that only says what was imported goes by itself; one with problems stays until closed.
  const r = report.value;
  useEffect(() => {
    if (!r || r.errors.length) return;
    const timer = setTimeout(() => report.value?.id === r.id && (report.value = null), 6000);
    return () => clearTimeout(timer);
  }, [r?.id]);

  return (
    <>
      {replacing.value && <ReplaceDialog key={replacing.value.id} pending={replacing.value} />}
      {dragging.value && (
        <div class="drop-overlay" aria-hidden="true">
          <div class="drop-target">
            <Icon name="import" />
            <strong>Drop a backup to import it</strong>
            <span class="muted small">A JSON file saved by Backup, one at a time. You'll be asked before a year is replaced.</span>
          </div>
        </div>
      )}
      {r && (
        <div class={`import-notice ${r.errors.length ? "has-errors" : ""}`} role={r.errors.length ? "alert" : "status"}>
          <div class="import-notice-text">
            {r.done && <p class="saved">{r.done}</p>}
            {r.heading && <p class="import-notice-heading">{r.heading}</p>}
            {r.errors.length > 0 && <ul class="errors">{r.errors.map((x) => <li>{x}</li>)}</ul>}
            {r.note && <p class="muted small">{r.note}</p>}
          </div>
          <button type="button" class="plain-button notice-close" aria-label="Close" onClick={() => (report.value = null)}>×</button>
        </div>
      )}
    </>
  );
}
