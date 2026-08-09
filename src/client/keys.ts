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
 * so it lives in one place and every function agrees with every other about what a usable
 * identifier is.
 *
 * There is deliberately no decoder here yet. One was written, reviewed, and removed: its
 * correctness rests on no identifier being a dotted prefix of one belonging to a DIFFERENT
 * question, `checkIdentifiers` does not enforce that (0013 · Q6), and nothing called it.
 * Shipping a decoder whose invariant is unchecked and whose only exercise is its own test
 * is what 0013 records as the mistake that produced the previous round of defects. It
 * belongs with 0011's rename-on-read (0013 · Q4), which is what will first need it.
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
 * The instance and the field are checked for dots as well as emptiness; the group is
 * checked only for emptiness, because a group identifier is dotted by construction
 * (`day1.chapters`). That asymmetry is the whole reason a decoder is hard, and it is why
 * there is not one here yet. The build enforces the same shape on the schema side
 * (`checkIdentifiers`), so a rejection here means a caller invented an identifier rather
 * than taking one from a question.
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
 * The key one field of a non-repeat question is stored under.
 *
 * `group.field`, with no instance segment — a `single` has no field segment at all and is
 * stored under its group identifier alone, which `orderKey` also returns for a repeat. The
 * two cannot collide: a group identifier names exactly one question, and a question has
 * exactly one kind.
 *
 * Here rather than spelled inline at each call site. prompt.ts and agent-answers.ts are the
 * two halves of one round trip and each had its own copy of this template; this file's own
 * header records what happened the last time one fact about key shape lived in two places.
 */
export function fieldKey(group: string, field: string): string {
  if (group === "") {
    throw new Error("a group identifier is required");
  }
  if (field === "" || field.includes(SEPARATOR)) {
    throw new Error(`field identifier ${JSON.stringify(field)} is not usable in a key`);
  }
  return `${group}${SEPARATOR}${field}`;
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
