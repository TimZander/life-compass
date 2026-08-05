/**
 * Reading a backup file back in, and replacing what is here with it.
 *
 * This is the destructive half of #25 and the only operation in the application that can
 * take answers away. Everything about its shape follows from that.
 *
 * **Nothing is written until the whole file has been read and accepted** (0009 · C4). A
 * partial import is worse than a refused one: the reader is left with some of the file and
 * some of what was here, no way to tell which is which, and no way back to either.
 *
 * **It replaces rather than merges** (0009 · C7). Merge would have to decide, per key,
 * whether the file or the device wins, and the two are not independent — an instance order
 * and the answers it addresses are one fact spread over several keys (0013). Picking
 * winners key by key can produce a group whose answers sit under identifiers its order does
 * not list, unreachable from the page and invisible to the reader who now believes they
 * merged. Replace has one meaning and it can be said in a sentence.
 *
 * **The reader confirms they hold a backup first** (0009 · C8). An earlier version of that
 * consequence said the import could simply export first and that this cost a function call.
 * It cannot: handing a file over is a synthetic click on an object URL and reports no
 * outcome at all, which is why the export says "Downloading" and not "Saved". An import
 * that trusted it would destroy the store believing a backup had landed. Until something
 * can confirm bytes are on disk, a person looking at their own files is the only thing that
 * actually knows.
 */

import { FORMAT, VERSION, type Envelope } from "./export.ts";
import type { Store } from "./store.ts";

/**
 * Why a file was refused, in terms a reader can act on.
 *
 * A refusal has to say which of these it is. "Could not import" tells somebody holding the
 * only copy of their own writing nothing about whether the file is wrong, the app is too
 * old, or they picked the wrong thing out of their downloads.
 */
export type Refusal =
  | { readonly kind: "not-json" }
  | { readonly kind: "not-an-envelope" }
  | { readonly kind: "wrong-format"; readonly found: string }
  | { readonly kind: "newer-version"; readonly found: number }
  | { readonly kind: "encrypted"; readonly found: string }
  | { readonly kind: "bad-payload" };

export type Reading =
  | { readonly ok: true; readonly envelope: Envelope }
  | { readonly ok: false; readonly refusal: Refusal };

/** Whether a parsed value is a plain object rather than an array, null, or a primitive. */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Read a file's text as an envelope, or say why not.
 *
 * Every check runs before anything is returned as usable, and this function writes
 * nothing — it cannot, it has no store. That separation is what makes "never partially
 * imports" a property of the design rather than a promise about the order of statements.
 *
 * The version check refuses only what is NEWER. A file from an older envelope version is a
 * problem for the day a second version exists, and 0009's whole point is that the day
 * arrives with an envelope already in the wild to migrate from; refusing the future is the
 * part that has to be right now, because a file this build cannot understand is one it must
 * not guess at.
 */
export function readEnvelope(text: string): Reading {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, refusal: { kind: "not-json" } };
  }
  if (!isObject(parsed)) {
    return { ok: false, refusal: { kind: "not-an-envelope" } };
  }
  if (parsed["format"] !== FORMAT) {
    return {
      ok: false,
      refusal: { kind: "wrong-format", found: String(parsed["format"] ?? "nothing") },
    };
  }
  const version = parsed["version"];
  if (typeof version !== "number" || !Number.isInteger(version)) {
    return { ok: false, refusal: { kind: "not-an-envelope" } };
  }
  if (version > VERSION) {
    return { ok: false, refusal: { kind: "newer-version", found: version } };
  }
  // Checked before the payload, and by name rather than by shape: an encrypted file has a
  // payload that will not look like answers, and "this file is encrypted" is a different
  // thing to tell somebody than "this file is damaged" (0009 · C4).
  const encryption = parsed["encryption"];
  if (encryption !== "none") {
    return { ok: false, refusal: { kind: "encrypted", found: String(encryption ?? "nothing") } };
  }
  const payload = parsed["payload"];
  if (!isObject(payload)) {
    return { ok: false, refusal: { kind: "bad-payload" } };
  }
  // Every value, not a sample. A single non-string is the difference between a file that
  // restores and one that puts something into storage which `readAll` will later refuse to
  // read back — invisible until the next export drops it.
  for (const key of Object.keys(payload)) {
    if (typeof payload[key] !== "string") {
      return { ok: false, refusal: { kind: "bad-payload" } };
    }
  }
  const exportedAt = parsed["exportedAt"];
  return {
    ok: true,
    envelope: {
      format: FORMAT,
      version,
      encryption: "none",
      exportedAt: typeof exportedAt === "string" ? exportedAt : "",
      payload: payload as Record<string, string>,
    },
  };
}

/** How many answers a file holds, for telling the reader what they are about to trade. */
export function countIn(envelope: Envelope): number {
  return Object.keys(envelope.payload).length;
}

/**
 * Replace everything stored with the file's contents.
 *
 * One call into the store, which does it in a single transaction. Writing key by key would
 * mean a failure halfway leaves a store that is neither what the file said nor what was
 * here, and no record of which keys had already been replaced — the partial import 0009 · C4
 * forbids, arrived at through the back door.
 */
export async function restore(store: Store, envelope: Envelope): Promise<void> {
  await store.replaceAll(new Map(Object.entries(envelope.payload)));
}
