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
  /**
   * Which question set the payload was written against.
   *
   * `version` above is the ENVELOPE's and deliberately does not move for a schema edit,
   * so without this nothing in the file says which questions existed when it was written
   * — and an importer years later cannot tell an orphan (a question since retired) from a
   * key for a question that did not exist yet. 0011 · C3 makes that exact distinction the
   * reason orphans are carried at all, so a file that cannot support it is carrying them
   * for nothing.
   *
   * A digest rather than the identifiers themselves: the client has no copy of the schema
   * — `connect-src 'none'` means it cannot fetch `questions.json`, and 0013 has the
   * binding read everything from the markup instead — so the build stamps this into the
   * page and it is read from there. It answers "was this written against a different
   * question set", not "how different"; the registry (0011), which keeps every retired
   * identifier forever, answers the rest.
   */
  readonly schema: string;
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
export async function envelopeOf(
  store: Store,
  exportedAt: Date,
  schema: string,
): Promise<Envelope> {
  const stored = await store.readAll();
  const payload: Record<string, string> = {};
  for (const key of [...stored.keys()].sort()) {
    const value = stored.get(key);
    if (value !== undefined) {
      payload[key] = value;
    }
  }
  return {
    format: FORMAT,
    version: VERSION,
    encryption: "none",
    exportedAt: exportedAt.toISOString(),
    schema,
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
 * The clock time is in it, and an earlier version left it out on the reasoning that two
 * exports in one day could overwrite because "the newer file is a superset of unchanged
 * answers". That is false. A reader who shortened or cleared an answer between the two
 * exports has a newer file that is strictly lossier, and the overwrite would destroy the
 * only copy of what they removed — in the one feature whose entire job is to not do that.
 *
 * Minutes rather than seconds: enough that two exports in a session are distinct, short
 * enough to stay readable. Colons are not legal in a filename on every platform, so the
 * time is hyphenated.
 */
export function filenameFor(exportedAt: Date): string {
  const iso = exportedAt.toISOString();
  const day = iso.slice(0, iso.indexOf("T"));
  const time = iso.slice(iso.indexOf("T") + 1, iso.indexOf(":", iso.indexOf(":") + 1)).replace(":", "-");
  return `life-compass-${day}-${time}.json`;
}

/** Where the build stamped the question set's fingerprint (0009 · C6). */
export const SCHEMA_META = "life-compass-schema";

/**
 * The schema fingerprint this page was built from.
 *
 * Falls back rather than throwing. A missing meta tag means a build that predates the
 * stamp or a page served from an old cache — neither is a reason to refuse somebody a
 * backup, which would put the file's metadata ahead of the answers it exists to protect.
 * "unknown" is at least honest, and an importer can treat it as "assume nothing".
 */
export function schemaOf(document: Document): string {
  const meta = document.querySelector(`meta[name="${SCHEMA_META}"]`);
  const content = meta?.getAttribute("content");
  return content === null || content === undefined || content === "" ? "unknown" : content;
}

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
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  // Not appended to the document: a click works without it in every browser this supports,
  // and an anchor left in the page would be a stray focusable element in the reader's tab
  // order — and briefly, one carrying a URL to everything they have ever written.
  anchor.click();
  view.setTimeout(() => view.URL.revokeObjectURL(url), 0);
}

/**
 * Everything the export control does: read the store, build the file, hand it over.
 *
 * Returns the filename so the caller can tell the reader what was saved. It throws rather
 * than reporting failure itself, because whether a failure becomes a banner is the page's
 * decision and not this module's.
 */
export async function saveBackup(
  store: Store,
  document: Document,
  exportedAt: Date,
): Promise<string> {
  const envelope = await envelopeOf(store, exportedAt, schemaOf(document));
  const filename = filenameFor(exportedAt);
  download(document, serialise(envelope), filename);
  return filename;
}
