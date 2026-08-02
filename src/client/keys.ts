/**
 * How a repeat group's answers are keyed in storage.
 *
 * docs/decisions/0011 stores a repeat as an ordered array of instances, each with its own
 * identifier, so that reordering, inserting and deleting are safe and an orphan is
 * traceable to a specific chapter rather than to "slot 3". 0013 works out what that means
 * for slots the build renders rather than the reader adds.
 *
 * Two key shapes, and the schema is what tells them apart — a bare group identifier is
 * the order, anything longer is an answer:
 *
 *     day1.chapters                  -> ["5f1c…","9a34…"]   the instances, in display order
 *     day1.chapters.5f1c….title      -> "The garage-band years"
 *
 * This is the one format in the project that cannot be changed once a reader has answers,
 * so it lives in one place with tests on it rather than being spelled out at each call
 * site. Single-valued questions are unaffected: their key stays the frozen identifier.
 */

/** Instance identifiers must not contain the separator, or a key cannot be read back. */
const SEPARATOR = ".";

/**
 * A fresh instance identifier.
 *
 * `crypto.randomUUID` per 0011. It is available in every browser this site supports and
 * over HTTPS only, which the site is — but it is absent in an insecure context, so the
 * failure is explicit rather than a key of "undefined" written into permanent storage.
 */
export function newInstanceId(): string {
  if (typeof crypto?.randomUUID !== "function") {
    throw new Error("crypto.randomUUID is unavailable; answers cannot be keyed safely");
  }
  return crypto.randomUUID();
}

/**
 * The key one answer inside a repeat instance is stored under.
 *
 * `group` and `field` come from the schema and are frozen (0011); `instance` comes from
 * `newInstanceId`. The identifier is rejected rather than escaped if it contains the
 * separator: escaping would make two different instances able to produce one key, and
 * this format has to be readable years from now by something simpler than this code.
 */
export function answerKey(group: string, instance: string, field: string): string {
  if (instance === "" || instance.includes(SEPARATOR)) {
    throw new Error(`instance identifier ${JSON.stringify(instance)} is not usable in a key`);
  }
  return `${group}${SEPARATOR}${instance}${SEPARATOR}${field}`;
}

/**
 * The key a repeat group's instance order is stored under — the group's own identifier.
 *
 * Deliberately not a suffixed key like `day1.chapters.__order`: a suffix is a name that
 * could one day collide with a real field, while the bare group identifier cannot, since
 * every answer key has at least two more segments after it.
 */
export function orderKey(group: string): string {
  return group;
}

/** The stored order of a group's instances, or nothing if it has never been written. */
export function readOrder(stored: string | undefined): readonly string[] {
  if (stored === undefined) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(stored);
    // Anything else is an entry this version cannot read. Returning empty rather than
    // throwing keeps one corrupt group from taking down a whole page of answers; the
    // stored value is left alone, so nothing is destroyed by being unreadable today.
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((one): one is string => typeof one === "string" && one !== "");
  } catch {
    return [];
  }
}

/** The order, ready to store. */
export function writeOrder(instances: readonly string[]): string {
  return JSON.stringify(instances);
}
