/**
 * How a repeat group's answers are keyed in storage.
 *
 * docs/decisions/0011 stores a repeat as an ordered list of instances so that reordering,
 * inserting and deleting are safe and an orphan is traceable to a specific chapter rather
 * than to "slot 3". 0013 works out where those identifiers come from for slots the build
 * renders rather than the reader adds, and 0011 · C8 records why the shape here differs
 * from the one 0011 first sketched: #24 saves at field granularity, and one JSON value per
 * group would rewrite every chapter on every keystroke.
 *
 * Two key shapes, told apart by the schema — a bare group identifier is the order,
 * anything longer is an answer:
 *
 *     day1.chapters                  -> ["5f1c…","9a34…"]   the instances, in display order
 *     day1.chapters.5f1c….title      -> "The garage-band years"
 *
 * This is the one format in the project that cannot be changed once a reader has answers,
 * so it lives in one place, every function agrees with every other about what a usable
 * identifier is, and `parseAnswerKey` exists so a key can be read back — without it,
 * 0011's rename-on-read could never reach an answer with an instance spliced into its
 * middle, and an orphaned instance could never be told from a live one.
 */

/** Instance identifiers must not contain the separator, or a key cannot be read back. */
const SEPARATOR = ".";

/**
 * One rule about what an instance identifier may be, used by everything here.
 *
 * An earlier version had `readOrder` accept anything non-empty while `answerKey` refused
 * a dotted one, so a stored order could pass the reader and then throw inside the writer,
 * mid-page — the loud failure the recoverable-order design exists to avoid. One predicate
 * means the two cannot drift apart again.
 */
function usable(instance: unknown): instance is string {
  return typeof instance === "string" && instance !== "" && !instance.includes(SEPARATOR);
}

/**
 * A fresh instance identifier.
 *
 * `crypto.randomUUID` per 0011. Available in every browser this site supports, and only
 * over a secure context — which the site is, but the failure is explicit rather than a
 * key of "undefined" written into permanent storage. Callers treat a throw here as
 * "storage is unavailable" and tell the reader, rather than letting it escape an input
 * handler (0011 · C6).
 */
export function newInstanceId(): string {
  if (typeof crypto === "undefined" || typeof crypto.randomUUID !== "function") {
    throw new Error("crypto.randomUUID is unavailable; answers cannot be keyed safely");
  }
  return crypto.randomUUID();
}

/**
 * The key one answer inside a repeat instance is stored under.
 *
 * All three parts are checked, not just the instance. A dotted or empty `group` or `field`
 * would produce a key `parseAnswerKey` could not take apart again, and this format has to
 * stay readable years from now by something simpler than this code. The build enforces the
 * same shape on the schema side (`checkIdentifiers`), so a rejection here means a caller
 * invented an identifier rather than taking one from a question.
 */
export function answerKey(group: string, instance: string, field: string): string {
  if (group === "") {
    throw new Error("a group identifier is required");
  }
  if (!usable(instance)) {
    throw new Error(`instance identifier ${JSON.stringify(instance)} is not usable in a key`);
  }
  if (field === "" || field.includes(SEPARATOR)) {
    throw new Error(`field identifier ${JSON.stringify(field)} is not usable in a key`);
  }
  return `${group}${SEPARATOR}${instance}${SEPARATOR}${field}`;
}

/**
 * Take an answer key apart again, given the group identifiers the schema knows.
 *
 * The group is found by match rather than by counting dots, because a group identifier
 * contains dots itself (`day1.chapters`). That works because no identifier may be a dotted
 * prefix of one belonging to a different question — 0013 · Q6, which is why that property
 * matters beyond tidiness.
 *
 * Returns nothing for a key that names no known group, which is what an answer left behind
 * by a retired question looks like. That is an orphan (0011 · C3) rather than an error, and
 * the caller decides what to show.
 */
export function parseAnswerKey(
  key: string,
  groups: Iterable<string>,
): { readonly group: string; readonly instance: string; readonly field: string } | undefined {
  for (const group of groups) {
    const prefix = `${group}${SEPARATOR}`;
    if (!key.startsWith(prefix)) {
      continue;
    }
    const rest = key.slice(prefix.length);
    const cut = rest.indexOf(SEPARATOR);
    if (cut <= 0 || cut === rest.length - 1) {
      continue;
    }
    const instance = rest.slice(0, cut);
    const field = rest.slice(cut + 1);
    if (!usable(instance) || field.includes(SEPARATOR)) {
      continue;
    }
    return { group, instance, field };
  }
  return undefined;
}

/** The key a repeat group's instance order is stored under — the group's own identifier. */
export function orderKey(group: string): string {
  return group;
}

/**
 * What a stored instance order turned out to be.
 *
 * `absent` and `unreadable` are deliberately different answers, and 0013 · Q3 is why:
 * materialising mints a fresh set of identifiers, so doing it because an order could not
 * be parsed would write new instances over a reader's existing answers and orphan every
 * one of them. Only `absent` may materialise. `unreadable` keeps whatever is stored,
 * untouched, and is something to tell the reader about rather than to recover from
 * silently.
 */
export type StoredOrder =
  | { readonly kind: "absent" }
  | { readonly kind: "unreadable"; readonly stored: string }
  | { readonly kind: "order"; readonly instances: readonly string[] };

/**
 * Read a group's instance order.
 *
 * Anything unusable makes the whole order unreadable rather than being filtered out.
 * Dropping entries was tried: it shortens the list, so every later instance moves up a
 * slot — the positional drift 0013 · O1 was rejected for — and the next write persists the
 * shortened list, permanently orphaning the answers under whatever was dropped. Refusing
 * the whole order keeps the stored bytes intact and recoverable.
 */
export function readOrder(stored: string | undefined): StoredOrder {
  if (stored === undefined) {
    return { kind: "absent" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(stored);
  } catch {
    return { kind: "unreadable", stored };
  }
  if (!Array.isArray(parsed) || !parsed.every(usable)) {
    return { kind: "unreadable", stored };
  }
  // Two slots resolving to one identifier means two blanks sharing a storage key, which is
  // the collision the whole instance scheme exists to prevent — so a duplicate makes the
  // order unreadable rather than being quietly de-duplicated into a shorter list.
  if (new Set(parsed).size !== parsed.length) {
    return { kind: "unreadable", stored };
  }
  return { kind: "order", instances: parsed };
}

/**
 * An instance order, ready to store.
 *
 * Validated on the way out as well as on the way in: this is the only path into permanent
 * storage for the format, and an order rejected on read is worse if this module is what
 * wrote it.
 */
export function writeOrder(instances: readonly string[]): string {
  for (const instance of instances) {
    if (!usable(instance)) {
      throw new Error(`instance identifier ${JSON.stringify(instance)} is not usable in a key`);
    }
  }
  if (new Set(instances).size !== instances.length) {
    throw new Error("an instance order may not repeat an identifier");
  }
  return JSON.stringify(instances);
}
