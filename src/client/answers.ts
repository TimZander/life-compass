/**
 * Autosave policy: when a keystroke becomes a write, and what happens when it fails.
 *
 * Everything here is above the `Store` interface so it can be tested in Node, which has
 * no IndexedDB. That split is the reason the interface exists: the decisions are here,
 * and store.ts is plumbing.
 *
 * The governing constraint is docs/decisions/0001. Someone is dictating into these
 * fields, so a save must never reach back into the DOM — no re-render, no re-focus, no
 * reading the field again later to see what it "really" says. This module is handed
 * values and returns nothing, which is the shape that makes reaching back impossible
 * rather than merely discouraged.
 */

import type { Store } from "./store.js";

/**
 * How long typing has to pause before a write.
 *
 * Long enough that dictation — which arrives in bursts with gaps between phrases —
 * writes once per phrase rather than once per burst, and short enough that a session
 * interrupted by a closed tab loses at most a phrase. Also flushed on demand, so the
 * page-hide path does not wait for it.
 */
export const QUIET_MS = 800;

export type Answers = {
  /** Everything stored, for populating a page. */
  load(): Promise<ReadonlyMap<string, string>>;
  /** Record a field's current value. Returns immediately; the write happens later. */
  set(field: string, value: string): void;
  /** Write everything outstanding now, and wait for it. */
  flush(): Promise<void>;
};

export type AnswersOptions = {
  /**
   * Called when a write fails, and again only after one has since succeeded.
   *
   * Storage failure is not hypothetical — private browsing, a full disk, and a revoked
   * permission all land here — and a reader who is told nothing keeps typing into
   * something that is not saving. Reporting every failure instead would put a message on
   * screen for every phrase, which 0001 forbids more strongly than it requires the
   * message.
   */
  readonly onFailure?: (error: unknown) => void;
  /** Called when a write succeeds after a failure was reported. */
  readonly onRecovery?: () => void;
  readonly quietMs?: number;
};

export function createAnswers(store: Store, options: AnswersOptions = {}): Answers {
  const quietMs = options.quietMs ?? QUIET_MS;

  /**
   * The newest value per field, waiting to be written.
   *
   * A map rather than a queue, so twenty keystrokes in one field become one write. The
   * field identifier is the coalescing key, which is what "save at field granularity"
   * means in practice: two fields edited in the same pause are two writes, and one field
   * edited twenty times is one.
   */
  const pending = new Map<string, string>();

  let timer: ReturnType<typeof setTimeout> | undefined;
  let writing: Promise<void> | undefined;
  let reportedFailure = false;

  /**
   * Drain `pending` until it is empty.
   *
   * Serialised deliberately: two overlapping drains could have their writes for the same
   * field land in either order, and the loser would be the newer value. Re-checking the
   * map after each await is also what makes a keystroke arriving mid-write safe — it is
   * simply picked up on the next pass rather than racing the one in flight.
   */
  async function drain(): Promise<void> {
    for (;;) {
      const next = pending.entries().next();
      if (next.done === true) {
        return;
      }
      const [field, value] = next.value;
      // Deleted BEFORE the await, so a keystroke during the write re-adds it and is not
      // lost by a delete-after-write clearing the newer value.
      pending.delete(field);
      try {
        await store.write(field, value);
        if (reportedFailure) {
          reportedFailure = false;
          options.onRecovery?.();
        }
      } catch (error) {
        // The value is dropped rather than retried forever. It is still in the field the
        // reader is looking at, a retry loop against a full disk never ends, and the
        // honest response to "this is not saving" is to say so.
        if (!reportedFailure) {
          reportedFailure = true;
          options.onFailure?.(error);
        }
      }
    }
  }

  function scheduleDrain(): void {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      timer = undefined;
      void flush();
    }, quietMs);
  }

  function flush(): Promise<void> {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
    // One drain at a time, and awaiting the running one is enough. `drain` re-checks
    // `pending` after every write, so anything added while it runs is picked up by the
    // same drain rather than needing another.
    //
    // A loop here was tried, to cover a value added after a drain's last check but before
    // its `finally` clears `writing`. That window is a microtask, and both callers — an
    // input handler and the page-hide handler — are macrotasks, so nothing can land in
    // it. The loop guarded a state unreachable from outside this module, and no test
    // could be written that failed without it.
    writing ??= drain().finally(() => {
      writing = undefined;
    });
    return writing;
  }

  return {
    async load() {
      return store.readAll();
    },

    set(field, value) {
      pending.set(field, value);
      scheduleDrain();
    },

    flush,
  };
}
