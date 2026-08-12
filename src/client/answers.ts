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

import type { Store } from "./store.ts";

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
 * A debounce alone waits for a pause, and dictation does not reliably pause: steady input
 * wrote nothing at all until it stopped, which a locked phone mid-flow would have lost
 * entirely. The ceiling bounds that loss to a few seconds rather than a whole session.
 *
 * It does not eliminate it. Up to this much speech is still unwritten at any moment, and
 * the page-hide flush that would narrow it further is not wired to anything yet — that
 * comes with the DOM binding, which app.ts wires. That bounds the window rather than
 * closing it: a device that dies outright still loses whatever had not been written.
 */
export const MAX_WAIT_MS = 5000;

export type Answers = {
  /** Everything stored, for populating a page. */
  load(): Promise<ReadonlyMap<string, string>>;
  /** Record a field's current value. Returns immediately; the write happens later. */
  set(field: string, value: string): void;
  /** Write everything outstanding now, and wait for it. */
  flush(): Promise<void>;
  /**
   * Stop retrying and release the timer.
   *
   * A store that never recovers is retried for as long as anything is queued, which is
   * right for a page — the reader is still looking at text that has not been saved. But
   * a pending timer keeps its host alive, so anything that outlives its page, a test
   * included, needs a way to say the work is over. Queued values are NOT written; call
   * `flush` first if they matter.
   */
  stop(): void;
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
    announce(() => options.onFailure?.(error));
  };

  /**
   * Call a handler without letting it break the write loop.
   *
   * A throwing `onFailure` propagated out of `drain`, which abandoned the pass — every
   * value it was still holding was dropped, and `void flush()` turned it into an
   * unhandled rejection. A caller's bug in a notification must not cost the answer the
   * notification is about.
   */
  const announce = (run: () => void): void => {
    try {
      run();
    } catch (error) {
      console.error("life-compass: an answers callback threw", error);
    }
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
        // Forgotten as soon as a later write for the same field lands. Without this, a
        // value that failed early in the pass was re-queued after the pass and written
        // OVER the newer text the reader dictated while it was running — the store ended
        // holding the older paragraph while the screen showed the newer one.
        deferred.delete(field);
        failed.delete(field);
        // Only once nothing is still failing. Clearing on any success meant a write to
        // one field announced recovery while another field's answer was still unsaved —
        // the reassurance being the thing that stops a reader checking.
        if (reportedFailure && failed.size === 0) {
          reportedFailure = false;
          announce(() => options.onRecovery?.());
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

    // The loop only exits with `pending` empty, so nothing here can overwrite a newer
    // value — the newer ones were already written above and removed from `deferred`.
    for (const [field, value] of deferred) {
      pending.set(field, value);
    }

    // Measured from this attempt, not from the original keystroke. Leaving it at the
    // first change meant a field that could never be written aged past the ceiling and
    // pinned the delay at zero, so every later keystroke — in any field — drained
    // immediately and the coalescing this module exists for stopped happening.
    oldestPendingAt = pending.size === 0 ? undefined : Date.now();
  }

  /** Set once `stop` is called; nothing queues or writes afterwards. */
  let stopped = false;

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
    // Stopped means stopped. Without this the latch below is only half a latch: `pagehide`
    // calls `flush` (app.ts), and a value that failed mid-drain is put back in `pending`
    // while `flush` still RESOLVES — so a caller that flushed, stopped, and then emptied the
    // store had that value written back into it by the page it was navigating away from.
    // erase.ts and import.ts both promise the reader nothing can land after this point.
    if (stopped) {
      return Promise.resolve();
    }
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
      // Anything a pass could not write is still queued, so try again on the timer. No
      // attempt budget: a bounded one had to decide what counts as progress, and the
      // answer it reached — reset the budget whenever any field succeeded — meant the
      // one case retries exist for, a field failing alongside a healthy one, was the
      // single case that never retried. The debounce already paces this to one attempt
      // per quiet period, which is a negligible cost against a store that may recover.
      // It does mean a store that never recovers is retried for as long as the page is
      // open. That is the right trade while the reader is looking at unsaved text, and
      // `stop` is how anything outliving its page ends it.
      if (pending.size > 0) {
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
      if (stopped) {
        return;
      }
      pending.set(field, value);
      oldestPendingAt ??= Date.now();
      scheduleDrain();
    },

    flush,

    stop() {
      // A latch, not a timer cancellation. It was the latter, and the contract above —
      // "queued values are NOT written" — was therefore false in the one case that matters:
      // a write that failed during a drain is deferred back into `pending`, so clearing the
      // timer left it sitting there for the next `flush` to pick up. The callers that rely
      // on this are the two irreversible operations, which stop autosave precisely so that
      // nothing lands on top of a store they are about to replace or empty.
      // Three guards for one property, and they are not equivalent: this flag is what
      // `flush` reads, clearing the queue is what makes the contract above literally true,
      // and refusing later `set`s is what stops a stopped instance arming fresh timers. Only
      // the first is observable from outside, so only the first is pinned by a test.
      stopped = true;
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
      pending.clear();
    },
  };
}
