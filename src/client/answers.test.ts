/**
 * Autosave policy under the conditions that actually occur.
 *
 * Dictation is the shape to hold in mind: long values arriving in bursts, with pauses
 * between phrases and none within them, and a session that can end at any moment because
 * a phone locked. The races below are not hypothetical — every one of them loses somebody
 * a paragraph of speech (docs/decisions/0001).
 *
 * A fake store rather than IndexedDB, which Node does not have. That is the whole reason
 * the `Store` interface exists: the decisions are testable here and store.ts is plumbing.
 */

import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { createAnswers, type Answers, type AnswersOptions } from "./answers.ts";
import type { Store } from "./store.ts";

const QUIET = 10;

type Held = { readonly field: string; readonly resolve: () => void };

type Recorder = Store & {
  /** Every write in the order it landed, as `field=value`. */
  readonly writes: string[];
  /** Writes suspended inside the store, oldest first. Only used when `hold` is true. */
  readonly held: Held[];
  fail: boolean;
  /** Fail only this field, for testing partial failure. */
  failField?: string;
  /** Fail this many writes, then start succeeding. */
  failTimes: number;
  /** Guards already claimed, so a second claim for one loses. */
  readonly claimed: Set<string>;
  hold: boolean;
  /** Wait for a write to reach the store, then let it through. */
  releaseNext(): Promise<void>;
  /** Let a specific queued write through, for landing them out of order. */
  releaseAt(index: number): Promise<void>;
};

function recorder(initial: ReadonlyMap<string, string> = new Map()): Recorder {
  const held: Held[] = [];
  const state: Recorder = {
    writes: [],
    held,
    fail: false,
    failTimes: 0,
    claimed: new Set<string>(),
    hold: false,

    async readAll() {
      return initial;
    },

    async merge() {
      throw new Error("merge is not part of this scenario");
    },
    async replaceAll() {
      // The autosave layer has no business replacing the whole store; if it ever calls
      // this, the test should say so rather than quietly succeed.
      throw new Error("answers must not replace the store");
    },

    async claim(guard, entries) {
      // The fake's guard is its own write log: a group is materialised once, and a second
      // claim for the same guard must lose rather than overwrite.
      if (state.claimed.has(guard)) {
        return false;
      }
      state.claimed.add(guard);
      for (const [key, value] of entries) {
        state.writes.push(`${key}=${value}`);
      }
      return true;
    },

    async write(field, value) {
      // A turn before doing anything, always. Succeeding synchronously meant `flush`
      // could stop awaiting the drain entirely and every test still passed — and `flush`
      // is the page-hide contract, so that was the one promise with no coverage at all.
      await Promise.resolve();
      if (state.hold) {
        // Queued rather than held in a single slot. One slot meant the test had to guess
        // when the store had been reached, and releasing a beat early or late either hung
        // or silently tested nothing.
        await new Promise<void>((resolve) => held.push({ field, resolve }));
      }
      if (state.failTimes > 0) {
        state.failTimes -= 1;
        throw new Error("quota exceeded");
      }
      if (state.fail || state.failField === field) {
        throw new Error("quota exceeded");
      }
      state.writes.push(`${field}=${value}`);
    },

    async releaseAt(index: number) {
      for (let attempt = 0; attempt < 100 && held.length <= index; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 1));
      }
      const [one] = held.splice(index, 1);
      assert.ok(one !== undefined, `expected a write waiting at ${index}`);
      one.resolve();
      await new Promise((resolve) => setTimeout(resolve, 1));
    },

    async releaseNext() {
      // Polls rather than assuming: the write may not have reached the store yet, and
      // the number of turns it takes is an implementation detail worth not encoding.
      for (let attempt = 0; attempt < 100 && held.length === 0; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 1));
      }
      const next = held.shift();
      assert.ok(next !== undefined, "expected a write to be waiting");
      next.resolve();
      await new Promise((resolve) => setTimeout(resolve, 1));
    },
  };
  return state;
}

/**
 * Every `Answers` a test makes, so they can all be stopped afterwards.
 *
 * A store that never recovers is retried for as long as anything is queued, which keeps
 * a timer — and therefore the test runner — alive. Stopping them in `after` is what turns
 * "this suite hangs" into "this suite finishes".
 */
const built: Answers[] = [];
after(() => {
  for (const answers of built) {
    answers.stop();
  }
});

function answersFor(store: Store, options: AnswersOptions = {}): Answers {
  const CEILING_WELL_ABOVE_THE_DEBOUNCE = QUIET * 100;
  // Typed, so a misspelled handler is a compile error rather than a test that passes
  // because the callback it asserts on was never wired up.
  const answers = createAnswers(store, {
    quietMs: QUIET,
    maxWaitMs: CEILING_WELL_ABOVE_THE_DEBOUNCE,
    ...options,
  });
  built.push(answers);
  return answers;
}

/** Let the debounce elapse and every queued microtask settle. */
async function quiet(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, QUIET * 3));
}

describe("autosave coalescing", () => {
  it("set_ManyKeystrokesInOneField_WritesOnce", async () => {
    // Arrange — a phrase of dictation arrives as many events. One write, not many.
    const store = recorder();
    const answers = answersFor(store);
    const PHRASE = "the year I drove home every weekend";

    // Act
    for (let i = 1; i <= PHRASE.length; i += 1) {
      answers.set("day1.threads", PHRASE.slice(0, i));
    }
    await quiet();

    // Assert
    assert.deepEqual(store.writes, [`day1.threads=${PHRASE}`]);
  });

  it("set_TwoFieldsInOnePause_WritesBoth", async () => {
    // Arrange — negative case for coalescing: the key is the field, so two fields are two
    // writes even inside a single quiet period.
    const store = recorder();
    const answers = answersFor(store);

    // Act
    answers.set("day1.patterns", "one");
    answers.set("day1.threads", "two");
    await quiet();

    // Assert
    assert.deepEqual([...store.writes].sort(), ["day1.patterns=one", "day1.threads=two"]);
  });

  it("set_NoActivity_WritesNothing", async () => {
    // Arrange & Act — negative case: nothing typed, nothing written.
    const store = recorder();
    answersFor(store);
    await quiet();

    // Assert
    assert.deepEqual(store.writes, []);
  });
});

describe("maximum wait", () => {
  it("set_SteadyInputWithNoPause_StillWritesWithinTheCeiling", async () => {
    // Arrange — the failure this exists for: a plain debounce restarts on every keystroke,
    // so dictating steadily produced zero writes until the reader stopped talking. A
    // locked phone mid-flow lost the whole session.
    const store = recorder();
    const CEILING = QUIET * 3;
    const answers = answersFor(store, { maxWaitMs: CEILING });

    // Act — a keystroke every few ms, never pausing long enough to trip the debounce.
    const started = Date.now();
    while (Date.now() - started < QUIET * 6) {
      answers.set("day1.threads", `so far ${Date.now() - started}ms`);
      await new Promise((resolve) => setTimeout(resolve, Math.max(1, QUIET / 4)));
    }

    // Assert — at least one write landed while they were still going.
    assert.ok(store.writes.length > 0, "steady input never wrote anything");
  });

  it("set_ShortBurstThenPause_WritesOnceOnTheDebounce", async () => {
    // Arrange — negative case: the ceiling must not turn every burst into several writes.
    const store = recorder();
    const CEILING_WELL_ABOVE_THE_DEBOUNCE = QUIET * 100;
    const answers = answersFor(store, { maxWaitMs: CEILING_WELL_ABOVE_THE_DEBOUNCE });

    // Act
    answers.set("day1.threads", "one");
    answers.set("day1.threads", "two");
    await quiet();

    // Assert
    assert.deepEqual(store.writes, ["day1.threads=two"]);
  });
});

describe("autosave races", () => {
  it("set_KeystrokeDuringAWrite_IsNotLost", async () => {
    // Arrange — the race that costs a phrase: a write is in flight when the next burst
    // arrives. The newer value must land, and must land last.
    const store = recorder();
    store.hold = true;
    const answers = answersFor(store);

    // Act
    answers.set("day1.threads", "first");
    await quiet();
    // The write is now suspended inside the store. Type again while it hangs.
    answers.set("day1.threads", "second");
    await store.releaseNext();
    await quiet();
    await store.releaseNext();
    await quiet();

    // Assert
    assert.deepEqual(store.writes, ["day1.threads=first", "day1.threads=second"]);
  });

  it("flush_ValueAddedWhileDraining_IsStillWritten", async () => {
    // Arrange — flush is the page-hide path, so it has to cover a value typed while an
    // earlier write is still in flight, not just what was pending when it was called.
    const store = recorder();
    store.hold = true;
    const answers = answersFor(store);
    answers.set("day1.threads", "first");
    await quiet();

    // Act — start a flush, add a value while the write hangs, then let both through.
    const flushed = answers.flush();
    answers.set("day1.patterns", "added midway");
    await store.releaseNext();
    await store.releaseNext();
    await flushed;

    // Assert — flush did not resolve until both had landed.
    assert.deepEqual([...store.writes].sort(), [
      "day1.patterns=added midway",
      "day1.threads=first",
    ]);
  });

  it("flush_NothingPending_ResolvesImmediately", async () => {
    // Arrange & Act — negative case, and the common one on page hide.
    const store = recorder();
    const answers = answersFor(store);
    await answers.flush();

    // Assert
    assert.deepEqual(store.writes, []);
  });

  it("flush_CalledTwiceConcurrently_DoesNotWriteTwice", async () => {
    // Arrange — negative case: two drains overlapping could land the same field's writes
    // in either order, and the loser would be the newer value.
    const store = recorder();
    const answers = answersFor(store);
    answers.set("day1.threads", "once");

    // Act
    await Promise.all([answers.flush(), answers.flush()]);

    // Assert
    assert.deepEqual(store.writes, ["day1.threads=once"]);
  });
});

describe("newer text always wins", () => {
  it("set_FieldRetypedWhileItsEarlierWriteFailed_KeepsTheNewerText", async () => {
    // Arrange — the worst bug this module has had. A value whose write failed was held
    // aside and re-queued after the pass; if the reader dictated new text into that same
    // field meanwhile, the stale value was written OVER it. The store ended holding the
    // older paragraph while the screen showed the newer one, and a reload reverted it.
    const store = recorder();
    const ONE_FAILING_WRITE = 1;
    store.failTimes = ONE_FAILING_WRITE;
    const answers = answersFor(store, { onFailure: () => {} });

    // Act — the first write fails; the reader is still talking while it does.
    answers.set("day1.threads", "the older text");
    const pass = answers.flush();
    answers.set("day1.threads", "THE NEWER DICTATED TEXT");
    await pass;
    await quiet();
    await answers.flush();

    // Assert — the newer text is what is stored, and nothing wrote over it afterwards.
    assert.equal(store.writes.at(-1), "day1.threads=THE NEWER DICTATED TEXT");
    assert.ok(!store.writes.includes("day1.threads=the older text"));
  });

  it("flush_OverlappingDrains_CannotLandTheSameFieldOutOfOrder", async () => {
    // Arrange — negative case for serialisation. Two drains in flight for one field can
    // have their writes land in either order, and the loser is the newer value. Released
    // in reverse here, which is what makes the ordering guarantee observable at all.
    const store = recorder();
    store.hold = true;
    const answers = answersFor(store);

    // Act
    answers.set("day1.threads", "one");
    const first = answers.flush();
    answers.set("day1.threads", "two");
    const second = answers.flush();

    // Always release the most recently queued write first. With one drain at a time only
    // one is ever in flight and the order is unaffected; with two, this lands the older
    // value last, which is the corruption the guard exists to prevent.
    const TURNS_TO_SETTLE = 40;
    for (let turn = 0; turn < TURNS_TO_SETTLE; turn += 1) {
      if (store.held.length > 0) {
        await store.releaseAt(store.held.length - 1);
      } else {
        await new Promise((resolve) => setTimeout(resolve, 1));
      }
    }
    await Promise.all([first, second]);

    // Assert
    assert.equal(store.writes.at(-1), "day1.threads=two");
  });
});

describe("flush waits for persistence", () => {
  it("flush_ReturnedPromise_ResolvesOnlyAfterTheWriteLands", async () => {
    // Arrange — the page-hide contract. Without this, `flush` could return
    // Promise.resolve() and drop every unsaved answer with the whole suite still green.
    const store = recorder();
    store.hold = true;
    const answers = answersFor(store);
    answers.set("day1.threads", "a dictated paragraph");

    // Act
    let resolved = false;
    const flushed = answers.flush().then(() => {
      resolved = true;
    });
    await new Promise((resolve) => setTimeout(resolve, QUIET));

    // Assert — still waiting, because the store has not let the write through.
    assert.equal(resolved, false, "flush resolved before the write landed");
    await store.releaseNext();
    await flushed;
    assert.deepEqual(store.writes, ["day1.threads=a dictated paragraph"]);
  });

  it("flush_TwoWritesInFlight_WaitsForBoth", async () => {
    // Arrange — negative counterpart: resolving after the first would strand the second.
    const store = recorder();
    store.hold = true;
    const answers = answersFor(store);
    answers.set("day1.threads", "one");
    answers.set("day1.patterns", "two");

    // Act
    let resolved = false;
    const flushed = answers.flush().then(() => {
      resolved = true;
    });
    await store.releaseNext();
    assert.equal(resolved, false, "flush resolved with a write still outstanding");
    await store.releaseNext();
    await flushed;

    // Assert
    assert.equal(store.writes.length, 2);
  });
});

describe("storage failure", () => {
  it("set_WriteFails_ReportsOnceRatherThanPerPhrase", async () => {
    // Arrange — a full disk fails every write. Reporting each one would put a message on
    // screen for every phrase, which 0001 forbids more strongly than it wants the message.
    const store = recorder();
    store.fail = true;
    const failures: unknown[] = [];
    const answers = answersFor(store, { onFailure: (error: unknown) => failures.push(error) });

    // Act
    answers.set("day1.threads", "one");
    await quiet();
    answers.set("day1.threads", "two");
    await quiet();
    answers.set("day1.patterns", "three");
    await quiet();

    // Assert
    assert.equal(failures.length, 1);
  });

  it("set_WriteFailsThenSucceeds_ReportsRecoveryAndCanReportAgain", async () => {
    // Arrange — the counterpart: silence after recovery would leave a reader believing
    // their answers are still not saving.
    const store = recorder();
    store.fail = true;
    let failures = 0;
    let recoveries = 0;
    const answers = answersFor(store, {
      onFailure: () => {
        failures += 1;
      },
      onRecovery: () => {
        recoveries += 1;
      },
    });

    // Act
    answers.set("day1.threads", "one");
    await quiet();
    store.fail = false;
    answers.set("day1.threads", "two");
    await quiet();
    store.fail = true;
    answers.set("day1.threads", "three");
    await quiet();

    // Assert
    assert.deepEqual({ failures, recoveries }, { failures: 2, recoveries: 1 });
  });

  it("set_WriteFails_ValueIsRetriedRatherThanDropped", async () => {
    // Arrange — dropping it lost the answer outright while the store was briefly
    // unavailable, and left the reader looking at text that would not survive a reload.
    const store = recorder();
    store.fail = true;
    const answers = answersFor(store);

    // Act — one failing write, then the store recovers and the reader types elsewhere.
    answers.set("day1.threads", "a dictated paragraph");
    await quiet();
    assert.deepEqual(store.writes, [], "precondition: the first attempt failed");
    store.fail = false;
    await answers.flush();

    // Assert — the value that failed is written, without being retyped.
    assert.deepEqual(store.writes, ["day1.threads=a dictated paragraph"]);
  });

  it("set_OneFieldStillFailing_DoesNotAnnounceRecovery", async () => {
    // Arrange — clearing the flag on any success meant a write to one field announced
    // recovery while another field's answer was still unsaved. The reassurance is what
    // stops a reader checking, so it has to be true.
    const store = recorder();
    let recoveries = 0;
    const answers = answersFor(store, {
      onFailure: () => {},
      onRecovery: () => {
        recoveries += 1;
      },
    });

    // Act — "threads" fails permanently; "patterns" writes fine.
    store.failField = "day1.threads";
    answers.set("day1.threads", "never lands");
    await quiet();
    answers.set("day1.patterns", "lands fine");
    await quiet();

    // Assert
    assert.ok(store.writes.includes("day1.patterns=lands fine"));
    assert.equal(recoveries, 0, "recovery announced while a field was still failing");
  });

  it("set_WriteFailsWithNoHandler_IsReportedOnTheConsole", async () => {
    // Arrange — `createAnswers(store)` with no options is a legitimate call, and this
    // layer losing a write is the one thing on the page that must not happen quietly.
    const store = recorder();
    store.fail = true;
    const errors: unknown[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => errors.push(args);

    // Act
    try {
      const answers = answersFor(store);
      answers.set("day1.threads", "one");
      await quiet();
    } finally {
      console.error = original;
    }

    // Assert
    assert.equal(errors.length, 1);
  });

  it("set_WriteFails_DoesNotRejectIntoTheCaller", async () => {
    // Arrange — negative case: `set` is called from an input handler. Throwing there
    // would surface as an unhandled rejection mid-keystroke.
    const store = recorder();
    store.fail = true;
    const answers = answersFor(store);

    // Act & Assert
    answers.set("day1.threads", "one");
    await assert.doesNotReject(() => answers.flush());
  });
});

describe("load", () => {
  it("load_ExistingAnswers_ReturnsThemForRestoring", async () => {
    // Arrange
    const stored = new Map([["day1.threads", "written last week"]]);

    // Act
    const answers = answersFor(recorder(stored));

    // Assert
    assert.deepEqual([...(await answers.load())], [...stored]);
  });
});

/**
 * `stop` as a latch rather than a timer cancellation (#63).
 *
 * Two irreversible operations — restoring over the store and erasing it — stop autosave
 * precisely so nothing lands on top of what they are about to replace or empty, and both
 * promise the reader exactly that. The promise was false: `stop` only cleared the timer.
 */
describe("stopping for good", () => {
  it("stop_AWriteThatFailedDuringTheFlush_IsNotWrittenByALaterOne", async () => {
    // Arrange — the path that made the guarantee false. A failed write is deferred back into
    // the queue and `flush` still RESOLVES, so a caller that flushed, stopped, and then
    // emptied the store had that value written back by the page-hide flush on its way out —
    // one answer surviving an erase the reader was told had completed.
    const FIELD = "day1.patterns";
    const SPOKEN = "said just before the store was emptied";
    const store = recorder();
    const answers = answersFor(store);
    store.fail = true;
    answers.set(FIELD, SPOKEN);
    await answers.flush();
    store.fail = false;
    store.writes.length = 0;

    // Act — exactly what erase.ts does, then what `pagehide` does behind it.
    answers.stop();
    await answers.flush();

    // Assert
    assert.deepEqual(store.writes, [], "a queued write outlived the stop");
  });

  it("stop_ThenSomethingDictated_QueuesNothingAndWritesNothing", async () => {
    // Arrange — negative case. After the store has been emptied the fields are still on
    // screen until the reload lands, so a phrase arriving in that window must go nowhere.
    const FIELD = "day1.patterns";
    const store = recorder();
    const answers = answersFor(store);

    // Act
    answers.stop();
    answers.set(FIELD, "dictated into a page that is going away");
    await answers.flush();
    await new Promise((resolve) => setTimeout(resolve, QUIET * 3));

    // Assert
    assert.deepEqual(store.writes, [], "a value dictated after the stop reached the store");
  });

  it("stop_BeforeAnythingWasSaid_IsHarmless", async () => {
    // Arrange — the ordinary case, so the latch cannot be satisfied by breaking normal use.
    const FIELD = "day1.patterns";
    const SPOKEN = "written the ordinary way";
    const store = recorder();
    const answers = answersFor(store);

    // Act
    answers.set(FIELD, SPOKEN);
    await answers.flush();

    // Assert
    assert.deepEqual(store.writes, [`${FIELD}=${SPOKEN}`], "an ordinary write was lost");
    answers.stop();
  });
});
