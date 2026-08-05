/**
 * The backup file: everything on this device, in one envelope.
 *
 * docs/decisions/0008 · C3 makes this mandatory rather than convenient. Browser storage
 * can be evicted under pressure and uninstalling can delete it outright, so an export is
 * the only copy that survives either — which is why it is a first-class control and not
 * something behind a settings menu.
 *
 * The envelope is 0009's, from the first release, even though encryption is not built
 * here. `encryption: "none"` today and `"passphrase-aes-gcm"` later, with the payload
 * replaced by ciphertext; an importer branches on that one field. Adding the envelope
 * afterwards would mean two incompatible generations of file in the wild and a
 * compatibility shim that never goes away.
 *
 * What goes in is whatever the store holds, verbatim. That includes two things it would
 * be easy to filter out and wrong to:
 *
 *   - Instance orders, whose values are JSON rather than prose (0013). They are answers'
 *     addresses; a backup without them restores text nothing can place.
 *   - Orphans — answers under identifiers no question uses any more. 0011 · C3 says they
 *     "belong in the envelope alongside live answers", because a retired question is not
 *     the same as a deleted answer, and this file is the only place the distinction can
 *     still be recovered from later.
 */

import type { Answers } from "./answers.ts";
import { BLANK_SELECTOR } from "./fields.ts";
import type { Store } from "./store.ts";

/** Identifies the file without reading its contents (0009). */
export const FORMAT = "life-compass/answers";

/**
 * The envelope's version, not the app's.
 *
 * It changes only when the SHAPE of this object changes — never for a schema edit, a new
 * worksheet, or a retired question, all of which are ordinary payload contents. An
 * importer refuses a version it does not know rather than guessing at it.
 */
export const VERSION = 1;

export type Envelope = {
  readonly format: typeof FORMAT;
  readonly version: number;
  /** 0009: `"none"` today, a named algorithm once encryption is opt-in per export. */
  readonly encryption: "none";
  /** When this file was written, so a reader with several can tell which is newest. */
  readonly exportedAt: string;
  /** Every key in the store, exactly as stored. */
  readonly payload: Readonly<Record<string, string>>;
};

/**
 * Build the envelope for everything currently stored.
 *
 * `exportedAt` is passed in rather than read from the clock here, so a test can assert the
 * whole file byte for byte instead of matching around a timestamp it cannot predict.
 *
 * Keys are sorted. Nothing depends on their order, which is exactly why it should be
 * fixed: two exports of unchanged answers are then byte-identical, so somebody keeping
 * successive backups can diff them and see what actually changed rather than a reshuffle.
 */
export async function envelopeOf(store: Store, exportedAt: Date): Promise<Envelope> {
  const stored = await store.readAll();
  // `Object.fromEntries`, never `payload[key] = value`. Assigning `__proto__` on a plain
  // object runs Object.prototype's setter instead of creating a property, so that key and
  // its answer vanish — no error, no warning, and a file that looks complete. Four keys in,
  // three out, in the one function whose whole contract is that nothing is dropped.
  // `fromEntries` DEFINES properties rather than assigning them, so every key survives, and
  // `JSON.parse` on the way back in defines them too, so the format is symmetric.
  const payload = Object.fromEntries(
    [...stored].sort(([one], [two]) => (one < two ? -1 : 1)),
  ) as Readonly<Record<string, string>>;
  return {
    format: FORMAT,
    version: VERSION,
    encryption: "none",
    exportedAt: exportedAt.toISOString(),
    payload,
  };
}

/**
 * The envelope as the bytes of a file.
 *
 * Indented, because this is a file a person may open. It is their own writing, and the
 * one artifact of this app they are told to look after themselves (0009 · C1); a wall of
 * minified JSON invites them to treat it as opaque machine output instead.
 */
export function serialise(envelope: Envelope): string {
  return `${JSON.stringify(envelope, null, 2)}\n`;
}

/**
 * A filename that sorts chronologically and says what it is.
 *
 * The clock is in it, and an earlier version left it out on the reasoning that two exports
 * in one day could overwrite because "the newer file is a superset of unchanged answers".
 * That is false: a reader who shortened or cleared an answer between the two has a newer
 * file that is strictly lossier, and the overwrite would destroy the only copy of what they
 * removed — in the one feature whose entire job is to not do that. Seconds, not minutes,
 * because the likeliest second export is an immediate retry after the first appeared to do
 * nothing, and minute granularity collides exactly there.
 *
 * LOCAL time, not UTC. `exportedAt` inside the file is ISO and absolute, which is what
 * anything mechanical should read; this string is for a person scanning a downloads folder,
 * and telling somebody in Denver that their evening export happened tomorrow is a small lie
 * in the one artifact they are asked to look after themselves. Local time still sorts, for
 * the only reader who will ever see these names.
 */
export function filenameFor(exportedAt: Date): string {
  const pad = (value: number): string => String(value).padStart(2, "0");
  const day = `${exportedAt.getFullYear()}-${pad(exportedAt.getMonth() + 1)}-${pad(exportedAt.getDate())}`;
  const time = `${pad(exportedAt.getHours())}-${pad(exportedAt.getMinutes())}-${pad(exportedAt.getSeconds())}`;
  return `life-compass-${day}-${time}.json`;
}

/**
 * How long a handed-over blob URL is left alive before being released.
 *
 * Long enough that no browser is still reading when it goes, short enough that the
 * reader's answers are not sitting behind a live URL for the rest of the session.
 */
const REVOKE_AFTER_MS = 1000;

/**
 * Write the backup out as a file the reader keeps.
 *
 * An object URL and a synthetic click, which is the only way to hand somebody a file
 * without a server — and there is no server (0003), nor may there be: `connect-src 'none'`
 * (0005, 0007) forbids this app from sending their answers anywhere. The file goes from
 * memory to their disk and touches nothing else.
 *
 * The URL is revoked on a later turn rather than immediately: revoking it in the same tick
 * as the click can cancel the download it names, since the browser has not necessarily
 * started reading the blob yet.
 */
export function download(document: Document, text: string, filename: string): void {
  const view = document.defaultView;
  if (view === null) {
    throw new Error("this document cannot download a file");
  }
  const url = view.URL.createObjectURL(new view.Blob([text], { type: "application/json" }));
  let handed = false;
  try {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.rel = "noopener";
    // Not appended to the document: a click works without it in every browser this
    // supports, and an anchor left in the page would be a stray focusable element in the
    // reader's tab order — and briefly, one carrying a URL to everything they have written.
    anchor.click();
    handed = true;
  } finally {
    // Released either way. Without the `finally`, a throwing `click` left a live
    // same-origin URL to the reader's entire workbook alive for the life of the document —
    // exactly the exposure the comment above says this avoids.
    //
    // A whole second when the click got through, not one macrotask. The browser has to
    // read the blob before it is revoked, and a revoke on the very next turn is the
    // tightest deferral there is; if it loses, the reader gets a truncated or empty file
    // that still lands in their downloads and looks like a backup. A second costs nothing
    // and is not a race.
    view.setTimeout(() => view.URL.revokeObjectURL(url), handed ? REVOKE_AFTER_MS : 0);
  }
}

/**
 * Everything the export control does: read the store, build the file, hand it over.
 *
 * Returns the filename so the caller can tell the reader what was saved. It throws rather
 * than reporting failure itself, because whether a failure becomes a banner is the page's
 * decision and not this module's.
 */
export async function saveBackup(
  answers: Answers,
  store: Store,
  document: Document,
  exportedAt: Date,
): Promise<string> {
  // Everything still in flight goes to storage FIRST. Autosave is debounced — 800ms of
  // quiet, a 5s ceiling — and reads straight from the store missed all of it: a reader who
  // finished a paragraph and tapped the button got a file without it, and an empty file if
  // that was all they had written. Worse, the reader most likely to reach for a backup is
  // the one who has just been told their answers are NOT being saved, whose whole unwritten
  // set is exactly what `flush` is holding. With import replacing the store (0009 · C7),
  // that gap turns into permanent loss.
  await answers.flush();
  const envelope = await envelopeOf(store, exportedAt);
  const filename = filenameFor(exportedAt);
  download(document, serialise(envelope), filename);
  return filename;
}

/**
 * Whether a page has anything on it that needs the store opened.
 *
 * Blanks OR the backup tools. It used to be blanks alone, which was true while the tools
 * sat on the pages that had them — and became false the moment they moved to a page of
 * their own. The backup page has no blanks, so the entry module returned before opening
 * anything and both controls stayed hidden forever: a page whose only purpose is those
 * controls, offering neither.
 *
 * Here rather than inline in app.ts because app.ts has no tests and cannot have them; this
 * is the decision that was wrong, so this is the thing that needs one.
 */
export function needsStore(document: Document): boolean {
  return document.querySelector(`${BLANK_SELECTOR}, #backup, #restore`) !== null;
}

export type BackupOptions = {
  /** Told the filename once the file has been handed to the browser. */
  readonly onHandedOver: (filename: string) => void;
  /** Told when the backup could not be produced at all. */
  readonly onFailure: (error: unknown) => void;
};

/**
 * Reveal the backup control and make it work.
 *
 * Here rather than in app.ts because app.ts has no tests and runs its side effects on
 * import, so everything put there is verified by reading it. 0014 · C2 exists because
 * DOM-touching client code checked that way shipped defects the suite could not see, and
 * nine separate mutations of this logic — including deleting it outright, and swapping the
 * honest "Downloading" wording back to the "Saved" it must never claim — passed a green
 * suite while it lived there.
 *
 * The section is revealed here, not in the markup, because until this runs there is no
 * working store behind it, and a control that is visible before it can do anything is one
 * somebody presses and watches do nothing.
 */
export function wireBackup(
  document: Document,
  answers: Answers,
  store: Store,
  options: BackupOptions,
): void {
  const section = document.getElementById("backup");
  const button = document.getElementById("backup-save");
  if (section === null || button === null) {
    // The build emits both on every page that gets here, so missing means the markup and
    // this module have drifted apart — and the symptom is a backup control that simply is
    // not there, on the one feature 0008 · C3 calls mandatory. Said out loud, the way
    // banner.ts does for its own missing region, rather than absorbed.
    console.error("life-compass: the backup control is missing from this page");
    return;
  }
  section.hidden = false;
  let running = false;
  button.addEventListener("click", () => {
    // `aria-disabled` and a flag, not the `disabled` attribute. A disabled element cannot
    // hold focus, so disabling the button somebody has just activated drops them to the
    // document body mid-operation and then re-enables it behind them — losing a keyboard or
    // screen-reader reader their place in the one flow they were told to use (0001).
    if (running) {
      return;
    }
    running = true;
    button.setAttribute("aria-disabled", "true");
    saveBackup(answers, store, document, new Date())
      .then(options.onHandedOver)
      .catch(options.onFailure)
      .finally(() => {
        running = false;
        button.removeAttribute("aria-disabled");
      });
  });
}
