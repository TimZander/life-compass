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

/**
 * The longest a value may sit unwritten, however steadily the reader is going.
 *
 * A debounce alone waits for a pause, and dictation does not reliably pause: someone
 * speaking steadily produced zero writes in testing until they stopped. That is the exact
 * session #24 exists to protect — a locked phone or a dropped tab mid-flow would have lost
 * all of it. This is the ceiling that makes "an interrupted session resumes without
 * re-speaking anything" true rather than aspirational.
 */
export const MAX_WAIT_MS = 5000;

/**
 * How many times a failing write is retried on its own before it waits for a reason.
 *
 * Enough to ride out a transient error, few enough that a genuinely broken store is not
 * written to forever in the background. After this the value stays queued, and the next
 * keystroke or the page-hide flush is what tries again.
 */
const MAX_RETRIES = 3;

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
  readonly maxWaitMs?: number;
};

export function createAnswers(store: Store, options: AnswersOptions = {}): Answers {
  const quietMs = options.quietMs ?? QUIET_MS;
  const maxWaitMs = options.maxWaitMs ?? MAX_WAIT_MS;

  /**
   * Reported once per run of failures, and never silently.
   *
   * A caller that passes no handler still gets the error on the console: this layer
   * losing a write is the one thing on the page that must not happen quietly, and
   * `createAnswers(store)` with no options is a legitimate call.
   */
  const report = (error: unknown): void => {
    if (options.onFailure === undefined) {
      console.error("life-compass: an answer could not be saved", error);
      return;
    }
    options.onFailure(error);
  };

  /**
   * The newest value per field, waiting to be written.
   *
   * A map rather than a queue, so twenty keystrokes in one field become one write. The
   * field identifier is the coalescing key, which is what "save at field granularity"
   * means in practice: two fields edited in the same pause are two writes, and one field
   * edited twenty times is one.
   */
  const pending = new Map<string, string>();

  /** Fields whose last write failed and which are still queued. */
  const failed = new Set<string>();

  let timer: ReturnType<typeof setTimeout> | undefined;
  let writing: Promise<void> | undefined;
  let reportedFailure = false;
  let consecutiveFailures = 0;
  /** When the oldest unwritten change was made, for the maximum-wait ceiling. */
  let oldestPendingAt: number | undefined;

  /**
   * Drain `pending` until it is empty.
   *
   * Serialised deliberately: two overlapping drains could have their writes for the same
   * field land in either order, and the loser would be the newer value. Re-checking the
   * map after each await is also what makes a keystroke arriving mid-write safe — it is
   * simply picked up on the next pass rather than racing the one in flight.
   */
  async function drain(): Promise<void> {
    // Failures are held aside rather than retried inside this pass. Putting them straight
    // back meant the loop picked the same field again immediately and spun; returning on
    // the first failure was worse — one field that could never be written starved every
    // other field on the page, so a single bad value stopped the whole workbook saving.
    const deferred = new Map<string, string>();
    let wroteSomething = false;

    for (;;) {
      const next = pending.entries().next();
      if (next.done === true) {
        break;
      }
      const [field, value] = next.value;
      // Deleted BEFORE the await, so a keystroke during the write re-adds it and is not
      // lost by a delete-after-write clearing the newer value.
      pending.delete(field);
      try {
        await store.write(field, value);
        wroteSomething = true;
        failed.delete(field);
        // Only once nothing is still failing. Clearing on any success meant a write to
        // one field announced recovery while another field's answer was still unsaved —
        // the reassurance being the thing that stops a reader checking.
        if (reportedFailure && failed.size === 0) {
          reportedFailure = false;
          options.onRecovery?.();
        }
      } catch (error) {
        // Kept, not dropped. Dropping lost the value outright while the store was
        // momentarily unavailable, and left the reader looking at text that would not
        // survive a reload.
        deferred.set(field, value);
        failed.add(field);
        if (!reportedFailure) {
          reportedFailure = true;
          report(error);
        }
      }
    }

    // A newer value for the same field wins: it is the one the reader can see.
    for (const [field, value] of deferred) {
      if (!pending.has(field)) {
        pending.set(field, value);
      }
    }

    // Progress, not failures, is what resets the budget. A pass that wrote something is
    // evidence the store works, even if one field in it did not.
    if (wroteSomething) {
      consecutiveFailures = 0;
    } else if (deferred.size > 0) {
      consecutiveFailures += 1;
    }
    if (pending.size === 0) {
      oldestPendingAt = undefined;
    }
  }

  function scheduleDrain(): void {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
    // The debounce, capped by how long the oldest change has already waited. Restarting a
    // plain debounce on every keystroke means steady input never writes at all, which is
    // exactly the shape dictation takes.
    const waited = oldestPendingAt === undefined ? 0 : Date.now() - oldestPendingAt;
    const delay = Math.max(0, Math.min(quietMs, maxWaitMs - waited));
    timer = setTimeout(() => {
      timer = undefined;
      void flush();
    }, delay);
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
      // A pass that stopped on a failure leaves the value queued. Retry on the timer a
      // bounded number of times so a transient error heals itself, then stop and let the
      // next keystroke — or the page-hide flush — be the reason to try again, rather than
      // writing to a broken store forever in the background.
      if (pending.size > 0 && consecutiveFailures > 0 && consecutiveFailures < MAX_RETRIES) {
        scheduleDrain();
      }
    });
    return writing;
  }

  return {
    // Rejects, unlike `set`, which never does. Failing to load is worth telling the
    // reader about before they start typing over answers that exist but did not appear;
    // failing to save mid-sentence is not worth interrupting them for (0001).
    load: () => store.readAll(),

    set(field, value) {
      pending.set(field, value);
      oldestPendingAt ??= Date.now();
      scheduleDrain();
    },

    flush,
  };
}
