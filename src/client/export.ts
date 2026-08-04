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
